// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeGitHub, OWNER, setCookie, startTestApp } from './test-helpers.js'

/** @type {Awaited<ReturnType<typeof startTestApp>>} */
let app

beforeEach(async () => {
  app = await startTestApp()
})

afterEach(async () => {
  await app.stop()
})

const trade = {
  ticker: 'SPY', option_type: 'call', strike: 450, expiration: '2026-10-17', contracts: 2,
  entry_date: '2026-09-20', entry_premium: 2.35, setup: '4H breakout', notes: '', checklist: [],
}

describe('signed out', () => {
  it('refuses every data route with 401', async () => {
    for (const path of ['/api/trades', '/api/trades/1', '/api/rules', '/api/stats', '/api/setups', '/api/activity', '/api/me']) {
      expect(await app.call(path), path).toEqual({ status: 401, body: { error: 'Sign in to use the journal.' } })
    }
    expect((await app.call('/api/trades', { method: 'POST', body: trade })).status).toBe(401)
    expect((await app.call('/api/rules', { method: 'POST', body: { text: 'x' } })).status).toBe(401)
  })

  it('still answers /api/version', async () => {
    expect(await app.call('/api/version')).toEqual({ status: 200, body: { commit: 'dev' } })
  })

  it('serves the pages', async () => {
    await app.stop()
    const dir = mkdtempSync(join(tmpdir(), 'journal-static-'))
    writeFileSync(join(dir, 'index.html'), '<p>journal</p>')
    app = await startTestApp({ staticDir: dir })
    const page = await fetch(`${app.base}/stats`)
    expect(page.status).toBe(200)
    expect(await page.text()).toBe('<p>journal</p>')
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a made-up session cookie', async () => {
    expect((await app.call('/api/trades', { cookie: 'tj_session=not-a-real-token' })).status).toBe(401)
  })
})

describe('signing in', () => {
  it('sends the browser to GitHub with the client id, this server\'s callback, a state, and no scope', async () => {
    const start = await fetch(`${app.base}/api/auth/github`, { redirect: 'manual' })
    expect(start.status).toBe(302)
    const to = new URL(/** @type {string} */ (start.headers.get('location')))
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(to.searchParams.get('client_id')).toBe('test-client')
    expect(to.searchParams.get('redirect_uri')).toBe(`${app.base}/api/auth/github/callback`)
    expect(to.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/)
    expect(to.searchParams.has('scope')).toBe(false)
    expect(setCookie(start, 'tj_oauth_state')).toMatch(/HttpOnly/i)
  })

  it('sets an HttpOnly session cookie and reports who signed in', async () => {
    const owner = await app.signIn('owner')
    expect(await app.call('/api/me', { cookie: owner })).toEqual({
      status: 200, body: { id: expect.any(Number), login: 'owner', name: 'The Owner', avatar_url: OWNER.avatar_url, role: 'owner' },
    })
    const member = await app.signIn('member')
    expect((await app.call('/api/me', { cookie: member })).body).toMatchObject({ login: 'member', role: 'member' })
  })

  it('refuses a callback whose state does not match, without a session', async () => {
    const start = await fetch(`${app.base}/api/auth/github`, { redirect: 'manual' })
    const stateCookie = /** @type {string} */ (setCookie(start, 'tj_oauth_state')).split(';')[0]
    const back = await fetch(`${app.base}/api/auth/github/callback?code=owner&state=forged`, {
      redirect: 'manual', headers: { cookie: stateCookie },
    })
    expect(back.headers.get('location')).toBe('/?signin=failed')
    expect(setCookie(back, 'tj_session')).toBeUndefined()
  })

  it('refuses a callback with no state cookie at all', async () => {
    const back = await fetch(`${app.base}/api/auth/github/callback?code=owner&state=abc`, { redirect: 'manual' })
    expect(back.headers.get('location')).toBe('/?signin=failed')
  })

  it('sends the browser back with a message when GitHub refuses the code', async () => {
    await expect(app.signIn('stranger')).rejects.toThrow('/?signin=failed')
  })

  it('says sign-in is not configured when the GitHub settings are missing', async () => {
    await app.stop()
    app = await startTestApp({ auth: { ownerGithubId: OWNER.github_id } })
    expect(await app.call('/api/auth/github')).toEqual({ status: 503, body: { error: 'Sign-in is not configured on this server.' } })
  })

  it('signs out: the old cookie stops working', async () => {
    const owner = await app.signIn('owner')
    expect((await app.call('/api/auth/signout', { method: 'POST', cookie: owner })).status).toBe(204)
    expect((await app.call('/api/trades', { cookie: owner })).status).toBe(401)
  })
})

describe('levels', () => {
  it('lets members read the checklist but refuses every change to it with 403', async () => {
    const owner = await app.signIn('owner')
    const member = await app.signIn('member')
    const rule = (await app.call('/api/rules', { method: 'POST', body: { text: 'Trend agrees' }, cookie: owner })).body

    expect((await app.call('/api/rules', { cookie: member })).body).toEqual([rule])
    const refused = { status: 403, body: { error: 'Only the owner can change the rule checklist.' } }
    expect(await app.call('/api/rules', { method: 'POST', body: { text: 'Mine now' }, cookie: member })).toEqual(refused)
    expect(await app.call(`/api/rules/${rule.id}`, { method: 'PUT', body: { text: 'Renamed' }, cookie: member })).toEqual(refused)
    expect(await app.call(`/api/rules/${rule.id}`, { method: 'DELETE', cookie: member })).toEqual(refused)
    expect((await app.call('/api/rules', { cookie: owner })).body).toEqual([rule])
  })

  it('gives each user their own journal: another user\'s trade looks like it does not exist', async () => {
    const owner = await app.signIn('owner')
    const member = await app.signIn('member')
    const mine = (await app.call('/api/trades', { method: 'POST', body: { ...trade, exit_date: '2026-09-25', exit_premium: 3.1 }, cookie: owner })).body

    expect((await app.call('/api/trades', { cookie: member })).body).toEqual([])
    expect((await app.call(`/api/trades/${mine.id}`, { cookie: member })).status).toBe(404)
    expect((await app.call(`/api/trades/${mine.id}`, { method: 'PUT', body: trade, cookie: member })).status).toBe(404)
    expect((await app.call(`/api/trades/${mine.id}`, { method: 'DELETE', cookie: member })).status).toBe(404)
    expect((await app.call('/api/stats', { cookie: member })).body.overview.n).toBe(0)
    expect((await app.call('/api/setups', { cookie: member })).body).toEqual([])
    expect((await app.call('/api/activity', { cookie: member })).body.days).toEqual([])

    const theirs = await app.call('/api/trades', { method: 'POST', body: { ...trade, ticker: 'QQQ' }, cookie: member })
    expect(theirs.status).toBe(201)
    expect((await app.call('/api/trades', { cookie: member })).body.map((t) => t.ticker)).toEqual(['QQQ'])
    expect((await app.call('/api/trades', { cookie: owner })).body.map((t) => t.ticker)).toEqual(['SPY'])
    expect((await app.call(`/api/trades/${mine.id}`, { cookie: owner })).status).toBe(200)
  })

  it('makes nobody the owner when OWNER_GITHUB_ID is missing', async () => {
    await app.stop()
    app = await startTestApp({ auth: { clientId: 'c', clientSecret: 's', ownerGithubId: NaN, github: fakeGitHub({ owner: OWNER }) } })
    const owner = await app.signIn('owner')
    expect((await app.call('/api/me', { cookie: owner })).body.role).toBe('member')
    expect((await app.call('/api/rules', { method: 'POST', body: { text: 'x' }, cookie: owner })).status).toBe(403)
  })
})
