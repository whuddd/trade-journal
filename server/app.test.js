// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp } from './test-helpers.js'

// These tests exercise the journal itself, signed in as the owner, who may do everything.
// Who may do what is tested in auth.test.js.

/** @type {Awaited<ReturnType<typeof startTestApp>>} */
let app
let owner = ''

beforeEach(async () => {
  app = await startTestApp()
  owner = await app.signIn('owner')
})

afterEach(async () => {
  await app.stop()
})

/**
 * @param {string} path
 * @param {{method?: string, body?: unknown, raw?: string}} [options]
 */
const call = (path, options = {}) => app.call(path, { cookie: owner, ...options })

const trade = {
  ticker: 'spy', option_type: 'call', strike: 450, expiration: '2026-10-17', contracts: 2,
  entry_date: '2026-09-20', entry_premium: 2.35, setup: '4H breakout', notes: '', checklist: [],
}

describe('rules API', () => {
  it('creates, lists, renames and deletes', async () => {
    const created = await call('/api/rules', { method: 'POST', body: { text: 'Trend agrees' } })
    expect(created.status).toBe(201)
    expect((await call('/api/rules')).body).toEqual([created.body])
    const renamed = await call(`/api/rules/${created.body.id}`, { method: 'PUT', body: { text: 'Trend agrees M/W' } })
    expect(renamed.body.text).toBe('Trend agrees M/W')
    expect((await call(`/api/rules/${created.body.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(`/api/rules/${created.body.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('rejects blanks with 400 and duplicates with 409', async () => {
    expect((await call('/api/rules', { method: 'POST', body: { text: '' } }))).toEqual({ status: 400, body: { error: 'Rule text is required.' } })
    await call('/api/rules', { method: 'POST', body: { text: 'Trend agrees' } })
    const dup = await call('/api/rules', { method: 'POST', body: { text: 'TREND AGREES' } })
    expect(dup).toEqual({ status: 409, body: { error: 'That rule already exists.' } })
  })

  it('rejects bad renames with 400, missing rules with 404, and duplicate renames with 409', async () => {
    const a = (await call('/api/rules', { method: 'POST', body: { text: 'Trend agrees' } })).body
    await call('/api/rules', { method: 'POST', body: { text: 'Risk defined' } })

    expect((await call(`/api/rules/${a.id}`, { method: 'PUT', body: { text: '' } })))
      .toEqual({ status: 400, body: { error: 'Rule text is required.' } })

    expect((await call('/api/rules/999', { method: 'PUT', body: { text: 'Anything' } })).status).toBe(404)

    expect((await call(`/api/rules/${a.id}`, { method: 'PUT', body: { text: 'RISK DEFINED' } })))
      .toEqual({ status: 409, body: { error: 'That rule already exists.' } })
  })

  it('removes a deleted rule from existing trades checklists', async () => {
    const rule = (await call('/api/rules', { method: 'POST', body: { text: 'Trend agrees' } })).body
    const created = await call('/api/trades', { method: 'POST', body: { ...trade, checklist: [{ rule_id: rule.id, followed: true }] } })
    expect(created.body.checklist).toEqual([{ rule_id: rule.id, followed: true }])

    expect((await call(`/api/rules/${rule.id}`, { method: 'DELETE' })).status).toBe(204)

    const after = await call(`/api/trades/${created.body.id}`)
    expect(after.body.checklist).toEqual([])
    expect(after.body.score).toBeNull()
  })
})

describe('trades API', () => {
  it('creates, reads, closes, edits after close and deletes', async () => {
    const rule = (await call('/api/rules', { method: 'POST', body: { text: 'Trend agrees' } })).body
    const created = await call('/api/trades', { method: 'POST', body: { ...trade, checklist: [{ rule_id: rule.id, followed: true }] } })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ ticker: 'SPY', status: 'open', pnl: null })

    const id = created.body.id
    const closedBody = { ...trade, exit_date: '2026-09-25', exit_premium: 3.1, checklist: [{ rule_id: rule.id, followed: true }] }
    const closed = await call(`/api/trades/${id}`, { method: 'PUT', body: closedBody })
    expect(closed.body).toMatchObject({ status: 'closed', pnl: 150, edits: [] })

    const edited = await call(`/api/trades/${id}`, { method: 'PUT', body: { ...closedBody, exit_premium: 3.4 } })
    expect(edited.body.edits).toEqual([expect.objectContaining({ field: 'exit_premium', old_value: '3.1', new_value: '3.4' })])

    const list = await call('/api/trades')
    expect(list.body[0]).toMatchObject({ id, edits_after_close: 1 })
    expect(list.body[0].edits).toBeUndefined()

    expect((await call(`/api/trades/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(`/api/trades/${id}`)).status).toBe(404)
  })

  it('returns 400 with a plain message for bad input', async () => {
    const bad = await call('/api/trades', { method: 'POST', body: { ...trade, strike: -1 } })
    expect(bad).toEqual({ status: 400, body: { error: 'Strike must be a positive number.' } })
  })

  it('returns 400 for a body that is not JSON', async () => {
    const bad = await call('/api/trades', { method: 'POST', raw: '{nope' })
    expect(bad).toEqual({ status: 400, body: { error: 'Request body must be valid JSON.' } })
  })

  it('returns 404 for missing trades and unknown rules in a checklist', async () => {
    expect((await call('/api/trades/999')).status).toBe(404)
    expect((await call('/api/trades/abc')).status).toBe(404)
    expect((await call('/api/trades/999', { method: 'PUT', body: trade })).status).toBe(404)
    const orphan = await call('/api/trades', { method: 'POST', body: { ...trade, checklist: [{ rule_id: 42, followed: true }] } })
    expect(orphan).toEqual({ status: 404, body: { error: 'Rule 42 no longer exists.' } })
  })

  it('gets a single trade, rejects a bad edit with 400, and 404s a second delete', async () => {
    const created = await call('/api/trades', { method: 'POST', body: trade })
    const id = created.body.id

    const got = await call(`/api/trades/${id}`)
    expect(got).toEqual({ status: 200, body: created.body })

    const bad = await call(`/api/trades/${id}`, { method: 'PUT', body: { ...trade, strike: -1 } })
    expect(bad).toEqual({ status: 400, body: { error: 'Strike must be a positive number.' } })

    expect((await call(`/api/trades/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(`/api/trades/${id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('returns 404 JSON for unknown API routes', async () => {
    expect(await call('/api/nothing')).toEqual({ status: 404, body: { error: 'No such API route.' } })
  })
})

describe('read-backs', () => {
  it('records activity on trade changes and reports streaks', async () => {
    expect((await call('/api/activity')).body).toEqual({ current_streak: 0, longest_streak: 0, days: [] })
    await call('/api/rules', { method: 'POST', body: { text: 'Rule changes do not count' } })
    expect((await call('/api/activity')).body.days).toEqual([])
    await call('/api/trades', { method: 'POST', body: trade })
    expect((await call('/api/activity')).body).toEqual({ current_streak: 1, longest_streak: 1, days: ['2026-09-27'] })
  })

  it('serves setups and stats', async () => {
    await call('/api/trades', { method: 'POST', body: { ...trade, exit_date: '2026-09-25', exit_premium: 3.1 } })
    expect((await call('/api/setups')).body).toEqual(['4H breakout'])
    const stats = (await call('/api/stats')).body
    expect(stats.overview).toMatchObject({ n: 1, total_pnl: 150, win_rate: 1 })
  })
})
