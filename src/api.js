const OFFLINE = "Can't reach the journal server."

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
    throw new Error(body.error ?? `Request failed with status ${response.status}.`)
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
