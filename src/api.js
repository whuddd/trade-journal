const OFFLINE = "Can't reach the journal server."

/** Fired on window whenever the server says the session is gone, so the app can show sign-in. */
export const SIGNED_OUT = 'tj:signed-out'

/** An error from the server, carrying its HTTP status. */
export class ApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
  let response
  try {
    response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' } })
  } catch {
    throw new Error(OFFLINE)
  }
  if (response.status === 204) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status >= 500 && typeof body.error !== 'string') throw new Error(OFFLINE)
    if (response.status === 401) window.dispatchEvent(new Event(SIGNED_OUT))
    throw new ApiError(body.error ?? `Request failed with status ${response.status}.`, response.status)
  }
  return body
}

/** @param {unknown} error */
export function messageOf(error) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** @param {unknown} body */
const json = (body) => JSON.stringify(body)

export const api = {
  /** The signed-in user, or null when nobody is. */
  me: () => request('/api/me').catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
  signOut: () => request('/api/auth/signout', { method: 'POST' }),
  listTrades: () => request('/api/trades'),
  /** @param {number} id */
  getTrade: (id) => request(`/api/trades/${id}`),
  /** @param {object} draft */
  createTrade: (draft) => request('/api/trades', { method: 'POST', body: json(draft) }),
  /** @param {number} id @param {object} draft */
  updateTrade: (id, draft) => request(`/api/trades/${id}`, { method: 'PUT', body: json(draft) }),
  /** @param {number} id */
  deleteTrade: (id) => request(`/api/trades/${id}`, { method: 'DELETE' }),
  listRules: () => request('/api/rules'),
  /** @param {string} text */
  createRule: (text) => request('/api/rules', { method: 'POST', body: json({ text }) }),
  /** @param {number} id @param {string} text */
  updateRule: (id, text) => request(`/api/rules/${id}`, { method: 'PUT', body: json({ text }) }),
  /** @param {number} id */
  deleteRule: (id) => request(`/api/rules/${id}`, { method: 'DELETE' }),
  stats: () => request('/api/stats'),
  setups: () => request('/api/setups'),
  activity: () => request('/api/activity'),
}
