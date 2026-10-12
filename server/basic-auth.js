import { createHash, timingSafeEqual } from 'node:crypto'

/** @param {string} value */
const digest = (value) => createHash('sha256').update(value).digest()

/**
 * Compares two strings in time that does not depend on where they first differ.
 *
 * @param {string} a
 * @param {string} b
 */
function same(a, b) {
  return timingSafeEqual(digest(a), digest(b))
}

/** @type {import('express').RequestHandler} */
function refuse(_req, res) {
  res.set('WWW-Authenticate', 'Basic realm="Trade Journal", charset="UTF-8"')
  res.status(401).json({ error: 'Sign in to use the journal.' })
}

/**
 * HTTP basic auth with one username and one password.
 *
 * @param {{user: string, password: string}} credentials
 * @returns {import('express').RequestHandler}
 */
export function basicAuth({ user, password }) {
  return (req, res, next) => {
    const [scheme, encoded] = (req.get('authorization') ?? '').split(' ')
    if (scheme !== 'Basic' || !encoded) return refuse(req, res, next)
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon < 0) return refuse(req, res, next)
    const userOk = same(decoded.slice(0, colon), user)
    const passwordOk = same(decoded.slice(colon + 1), password)
    if (userOk && passwordOk) return next()
    refuse(req, res, next)
  }
}

/**
 * Basic auth from BASIC_AUTH_USER and BASIC_AUTH_PASSWORD. On the host (VERCEL is set), a
 * missing setting refuses every request rather than leaving the API open. On a laptop with
 * neither set, auth is off.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {import('express').RequestHandler | undefined}
 */
export function basicAuthFromEnv(env) {
  const user = env.BASIC_AUTH_USER
  const password = env.BASIC_AUTH_PASSWORD
  if (user && password) return basicAuth({ user, password })
  if (env.VERCEL || user || password) return refuse
  return undefined
}
