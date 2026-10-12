// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore } from './db.js'
import { migrate } from './migrations.js'
import { pgliteDb } from './pg.js'

/** @type {ReturnType<typeof createStore>} */
let store

const input = {
  ticker: 'SPY', option_type: 'call', strike: 450, expiration: '2026-10-17', contracts: 2,
  entry_date: '2026-09-20', entry_premium: 2.35, exit_date: null, exit_premium: null,
  setup: '4H breakout', notes: '', checklist: [],
}

beforeEach(async () => {
  const db = await pgliteDb()
  await migrate(db)
  let tick = 0
  store = createStore(db, () => `2026-09-27T12:00:0${tick++ % 10}.000Z`)
})

afterEach(async () => {
  await store.close()
})

describe('migrations', () => {
  it('apply once and are recorded', async () => {
    const db = await pgliteDb()
    expect(await migrate(db)).toEqual([1])
    expect(await migrate(db)).toEqual([])
    await db.close()
  })
})

describe('rules', () => {
  it('creates, renames, detects duplicates ignoring case, deletes', async () => {
    const rule = await store.createRule('Trend agrees')
    expect(await store.listRules()).toEqual([rule])
    expect(await store.ruleTextTaken('trend AGREES')).toBe(true)
    expect(await store.ruleTextTaken('trend agrees', rule.id)).toBe(false)
    expect((await store.updateRule(rule.id, 'Trend agrees on M/W'))?.text).toBe('Trend agrees on M/W')
    expect(await store.deleteRule(rule.id)).toBe(true)
    expect(await store.deleteRule(rule.id)).toBe(false)
  })
})

describe('trades', () => {
  it('creates an open trade with its checklist and derived fields', async () => {
    const rule = await store.createRule('Trend agrees')
    const trade = await store.createTrade({ ...input, checklist: [{ rule_id: rule.id, followed: true }] })
    expect(trade).toMatchObject({
      ticker: 'SPY', status: 'open', pnl: null, edits_after_close: 0, edits: [],
      checklist: [{ rule_id: rule.id, followed: true }], score: { followed: 1, graded: 1, ratio: 1 },
    })
  })

  it('lists open trades first, then closed, newest entry first', async () => {
    const a = await store.createTrade({ ...input, entry_date: '2026-09-01', exit_date: '2026-09-02', exit_premium: 3 })
    const b = await store.createTrade({ ...input, entry_date: '2026-09-10' })
    const c = await store.createTrade({ ...input, entry_date: '2026-09-05', exit_date: '2026-09-06', exit_premium: 1 })
    expect((await store.listTrades()).map((t) => t.id)).toEqual([b.id, c.id, a.id])
  })

  it('does not record edits while open, including the edit that closes it', async () => {
    const trade = await store.createTrade(input)
    await store.updateTrade(trade.id, { ...input, notes: 'changed' })
    const closed = await store.updateTrade(trade.id, { ...input, notes: 'changed', exit_date: '2026-09-25', exit_premium: 3.1 })
    expect(closed?.edits).toEqual([])
    expect(closed?.pnl).toBe(150)
  })

  it('records each change to a closed trade, newest first', async () => {
    const rule = await store.createRule('Trend agrees')
    const closedInput = { ...input, exit_date: '2026-09-25', exit_premium: 3.1, checklist: [{ rule_id: rule.id, followed: true }] }
    const trade = await store.createTrade(closedInput)
    await store.updateTrade(trade.id, { ...closedInput, exit_premium: 3.4 })
    const after = await store.updateTrade(trade.id, { ...closedInput, exit_premium: 3.4, checklist: [{ rule_id: rule.id, followed: false }] })
    expect(after?.edits.map((e) => [e.field, e.old_value, e.new_value])).toEqual([
      ['checklist: Trend agrees', 'followed', 'broken'],
      ['exit_premium', '3.1', '3.4'],
    ])
    expect(after?.edits_after_close).toBe(2)
    expect((await store.listTrades())[0].edits_after_close).toBe(2)
  })

  it('deleting a rule removes its ticks; deleting a trade removes everything', async () => {
    const rule = await store.createRule('Trend agrees')
    const trade = await store.createTrade({ ...input, checklist: [{ rule_id: rule.id, followed: true }] })
    await store.deleteRule(rule.id)
    expect((await store.getTrade(trade.id))?.checklist).toEqual([])
    expect(await store.deleteTrade(trade.id)).toBe(true)
    expect(await store.getTrade(trade.id)).toBeUndefined()
    expect(await store.updateTrade(trade.id, input)).toBeUndefined()
  })

  it('rolls back a trade whose checklist names a missing rule', async () => {
    await expect(store.createTrade({ ...input, checklist: [{ rule_id: 42, followed: true }] })).rejects.toThrow()
    expect(await store.listTrades()).toEqual([])
  })

  it('lists setups by use', async () => {
    await store.createTrade({ ...input, setup: 'Reclaim' })
    await store.createTrade({ ...input, setup: '4H breakout' })
    await store.createTrade({ ...input, setup: '4H breakout' })
    expect(await store.listSetups()).toEqual(['4H breakout', 'Reclaim'])
  })
})

describe('activity', () => {
  it('stores each day once, sorted', async () => {
    await store.recordActivity('2026-09-27')
    await store.recordActivity('2026-09-26')
    await store.recordActivity('2026-09-27')
    expect(await store.listActivityDays()).toEqual(['2026-09-26', '2026-09-27'])
  })
})
