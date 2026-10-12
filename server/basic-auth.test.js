// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { basicAuthFromEnv } from './basic-auth.js'

/** Runs a middleware once and reports whether it let the request through. */
async function passes(middleware, authorization) {
  let status = 0
  let passed = false
  const req = { get: () => authorization }
  const res = { set() { return res }, status(code) { status = code; return res }, json() { return res } }
  await middleware(req, res, () => { passed = true })
  return passed ? 'next' : status
}

describe('basicAuthFromEnv', () => {
  const good = `Basic ${Buffer.from('me:pw').toString('base64')}`

  it('is off on a laptop with neither setting', () => {
    expect(basicAuthFromEnv({})).toBeUndefined()
  })

  it('checks the credentials when both are set', async () => {
    const auth = basicAuthFromEnv({ BASIC_AUTH_USER: 'me', BASIC_AUTH_PASSWORD: 'pw', VERCEL: '1' })
    expect(await passes(auth, good)).toBe('next')
    expect(await passes(auth, undefined)).toBe(401)
  })

  it('refuses everything on the host when a setting is missing, rather than leaving the API open', async () => {
    expect(await passes(basicAuthFromEnv({ VERCEL: '1' }), good)).toBe(401)
    expect(await passes(basicAuthFromEnv({ BASIC_AUTH_USER: 'me' }), good)).toBe(401)
  })
})
