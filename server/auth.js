import { createHash, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'tj_session'
const STATE_COOKIE = 'tj_oauth_state'
const SESSION_DAYS = 30
const STATE_MINUTES = 10
const CALLBACK_PATH = '/api/auth/github/callback'

/**
 * @typedef {{github_id: number, login: string, name: string | null, avatar_url: string | null}} Profile
 * @typedef {{
 *   exchangeCode: (args: {clientId: string, clientSecret: string, code: string, redirectUri: string}) => Promise<string>,
 *   fetchProfile: (accessToken: string) => Promise<Profile>,
 * }} GitHub
 * @typedef {{clientId?: string, clientSecret?: string, ownerGithubId: number, github?: GitHub}} AuthOptions
 */

/** The two calls to GitHub. Tests pass a fake in its place. @type {GitHub} */
export const github = {
  async exchangeCode({ clientId, clientSecret, code, redirectUri }) {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || typeof body.access_token !== 'string') {
      throw new Error(`GitHub refused the code exchange: ${body.error ?? response.status}`)
    }
    return body.access_token
  },
  async fetchProfile(accessToken) {
    const response = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'trade-journal' },
    })
    if (!response.ok) throw new Error(`GitHub refused the profile request: ${response.status}`)
    const user = await response.json()
    return { github_id: Number(user.id), login: String(user.login), name: user.name ?? null, avatar_url: user.avatar_url ?? null }
  },
}

/**
 * Sessions are stored by the SHA-256 of their token, so a copy of the database cannot be used
 * to sign in as anyone.
 *
 * @param {string} token
 */
export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

/**
 * @param {import('express').Request} req
 * @param {string} name
 */
function cookie(req, name) {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

/** @param {import('express').Request} req */
const origin = (req) => `${req.protocol}://${req.get('host')}`

/**
 * Settings for sign-in, read from the environment. OWNER_GITHUB_ID is GitHub's numeric account
 * id, which never changes even if the account is renamed. Missing, it makes nobody the owner.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {AuthOptions}
 */
export function authFromEnv(env) {
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    ownerGithubId: Number(env.OWNER_GITHUB_ID),
  }
}

/**
 * Sign-in with GitHub, sessions, and the two levels: owner and member.
 *
 * @param {import('./db.js').Store} store
 * @param {AuthOptions} options
 */
export function createAuth(store, { clientId, clientSecret, ownerGithubId, github: gh = github }) {
  /** @param {{github_id: number}} user */
  const roleOf = (user) => (user.github_id === ownerGithubId ? 'owner' : 'member')

  /** @param {import('express').Router} router */
  function mount(router) {
    router.get('/api/auth/github', (req, res) => {
      if (!clientId || !clientSecret) {
        res.status(503).json({ error: 'Sign-in is not configured on this server.' })
        return
      }
      const state = randomBytes(16).toString('hex')
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/api/auth', maxAge: STATE_MINUTES * 60_000,
      })
      // No scope: GitHub then grants read access to public profile information only.
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: origin(req) + CALLBACK_PATH, state })
      res.redirect(`https://github.com/login/oauth/authorize?${params}`)
    })

    router.get(CALLBACK_PATH, async (req, res) => {
      const expected = cookie(req, STATE_COOKIE)
      res.clearCookie(STATE_COOKIE, { path: '/api/auth' })
      const { code, state } = req.query
      if (!clientId || !clientSecret || typeof code !== 'string' || !expected || state !== expected) {
        res.redirect('/?signin=failed')
        return
      }
      try {
        const accessToken = await gh.exchangeCode({ clientId, clientSecret, code, redirectUri: origin(req) + CALLBACK_PATH })
        // The token is used for this one request and never stored.
        const user = await store.upsertUser(await gh.fetchProfile(accessToken))
        if (roleOf(user) === 'owner') await store.claimOrphans(user.id)
        const token = randomBytes(32).toString('base64url')
        const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
        await store.createSession(hashToken(token), user.id, expires.toISOString())
        res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', expires })
        res.redirect('/')
      } catch (error) {
        console.error(error)
        res.redirect('/?signin=failed')
      }
    })

    router.post('/api/auth/signout', async (req, res) => {
      const token = cookie(req, SESSION_COOKIE)
      if (token) await store.deleteSession(hashToken(token))
      res.clearCookie(SESSION_COOKIE, { path: '/' })
      res.status(204).end()
    })
  }

  /**
   * Refuses with 401 unless the request carries a live session. Sets res.locals.user.
   *
   * @type {import('express').RequestHandler}
   */
  async function requireUser(req, res, next) {
    const token = cookie(req, SESSION_COOKIE)
    const user = token ? await store.sessionUser(hashToken(token)) : undefined
    if (!user) {
      res.status(401).json({ error: 'Sign in to use the journal.' })
      return
    }
    res.locals.user = { ...user, role: roleOf(user) }
    next()
  }

  /**
   * Refuses with 403 unless the signed-in user is the owner. Runs after requireUser.
   *
   * @type {import('express').RequestHandler}
   */
  function requireOwner(_req, res, next) {
    if (res.locals.user?.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can change the rule checklist.' })
      return
    }
    next()
  }

  return { mount, requireUser, requireOwner }
}
