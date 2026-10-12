import { once } from 'node:events'
import { createApp } from './app.js'
import { createStore } from './db.js'
import { migrate } from './migrations.js'
import { pgliteDb } from './pg.js'

export const OWNER = { github_id: 1001, login: 'owner', name: 'The Owner', avatar_url: 'https://avatars.example/1001' }
export const MEMBER = { github_id: 2002, login: 'member', name: null, avatar_url: null }

/**
 * Stands in for GitHub: the code a test sends to the callback picks the profile that signs in.
 *
 * @param {Record<string, import('./auth.js').Profile>} profiles
 * @returns {import('./auth.js').GitHub}
 */
export function fakeGitHub(profiles) {
  return {
    async exchangeCode({ code }) {
      if (!profiles[code]) throw new Error('bad code')
      return `token:${code}`
    },
    async fetchProfile(token) {
      return profiles[token.slice('token:'.length)]
    },
  }
}

/** @param {Response} response @param {string} name */
export function setCookie(response, name) {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
}

/**
 * Starts the app on a fresh in-memory Postgres, with GitHub faked.
 *
 * @param {Parameters<typeof createApp>[1]} [options]
 */
export async function startTestApp(options = {}) {
  const db = await pgliteDb()
  await migrate(db)
  const store = createStore(db)
  const app = createApp(store, {
    today: () => '2026-09-27',
    auth: {
      clientId: 'test-client', clientSecret: 'test-secret', ownerGithubId: OWNER.github_id,
      github: fakeGitHub({ owner: OWNER, member: MEMBER }),
    },
    ...options,
  })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  const base = `http://127.0.0.1:${port}`

  /**
   * Signs in through the real routes: start, follow GitHub's redirect back with the code.
   *
   * @param {string} code 'owner' or 'member'
   * @returns {Promise<string>} the Cookie header value for the new session
   */
  async function signIn(code) {
    const start = await fetch(`${base}/api/auth/github`, { redirect: 'manual' })
    const state = new URL(/** @type {string} */ (start.headers.get('location'))).searchParams.get('state')
    const stateCookie = /** @type {string} */ (setCookie(start, 'tj_oauth_state')).split(';')[0]
    const back = await fetch(`${base}/api/auth/github/callback?code=${code}&state=${state}`, {
      redirect: 'manual', headers: { cookie: stateCookie },
    })
    const session = setCookie(back, 'tj_session')
    if (!session) throw new Error(`sign-in as ${code} failed: ${back.headers.get('location')}`)
    return session.split(';')[0]
  }

  /**
   * @param {string} path
   * @param {{method?: string, body?: unknown, raw?: string, cookie?: string}} [options]
   */
  async function call(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.cookie ? { cookie: options.cookie } : {}) },
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve))
    await store.close()
  }

  return { base, store, db, signIn, call, stop }
}
