// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore } from './db.js'

let dir = ''
/** @type {ReturnType<typeof createStore>} */
let store

const input = {
  ticker: 'SPY', option_type: 'call', strike: 450, expiration: '2026-10-17', contracts: 2,
  entry_date: '2026-09-20', entry_premium: 2.35, exit_date: null, exit_premium: null,
  setup: '4H breakout', notes: '', checklist: [],
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'journal-db-'))
  let tick = 0
  store = createStore(join(dir, 'test.db'), () => `2026-09-27T12:00:0${tick++ % 10}.000Z`)
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('rules', () => {
  it('creates, renames, detects duplicates ignoring case, deletes', () => {
    const rule = store.createRule('Trend agrees')
    expect(store.listRules()).toEqual([rule])
    expect(store.ruleTextTaken('trend AGREES')).toBe(true)
    expect(store.ruleTextTaken('trend agrees', rule.id)).toBe(false)
    expect(store.updateRule(rule.id, 'Trend agrees on M/W')?.text).toBe('Trend agrees on M/W')
    expect(store.deleteRule(rule.id)).toBe(true)
    expect(store.deleteRule(rule.id)).toBe(false)
  })
})

describe('trades', () => {
  it('creates an open trade with its checklist and derived fields', () => {
    const rule = store.createRule('Trend agrees')
    const trade = store.createTrade({ ...input, checklist: [{ rule_id: rule.id, followed: true }] })
    expect(trade).toMatchObject({
      ticker: 'SPY', status: 'open', pnl: null, edits_after_close: 0, edits: [],
      checklist: [{ rule_id: rule.id, followed: true }], score: { followed: 1, graded: 1, ratio: 1 },
    })
  })

  it('lists open trades first, then closed, newest entry first', () => {
    const a = store.createTrade({ ...input, entry_date: '2026-09-01', exit_date: '2026-09-02', exit_premium: 3 })
    const b = store.createTrade({ ...input, entry_date: '2026-09-10' })
    const c = store.createTrade({ ...input, entry_date: '2026-09-05', exit_date: '2026-09-06', exit_premium: 1 })
    expect(store.listTrades().map((t) => t.id)).toEqual([b.id, c.id, a.id])
  })

  it('does not record edits while open, including the edit that closes it', () => {
    const trade = store.createTrade(input)
    store.updateTrade(trade.id, { ...input, notes: 'changed' })
    const closed = store.updateTrade(trade.id, { ...input, notes: 'changed', exit_date: '2026-09-25', exit_premium: 3.1 })
    expect(closed?.edits).toEqual([])
    expect(closed?.pnl).toBe(150)
  })

  it('records each change to a closed trade, newest first', () => {
    const rule = store.createRule('Trend agrees')
    const closedInput = { ...input, exit_date: '2026-09-25', exit_premium: 3.1, checklist: [{ rule_id: rule.id, followed: true }] }
    const trade = store.createTrade(closedInput)
    store.updateTrade(trade.id, { ...closedInput, exit_premium: 3.4 })
    const after = store.updateTrade(trade.id, { ...closedInput, exit_premium: 3.4, checklist: [{ rule_id: rule.id, followed: false }] })
    expect(after?.edits.map((e) => [e.field, e.old_value, e.new_value])).toEqual([
      ['checklist: Trend agrees', 'followed', 'broken'],
      ['exit_premium', '3.1', '3.4'],
    ])
    expect(after?.edits_after_close).toBe(2)
    expect(store.listTrades()[0].edits_after_close).toBe(2)
  })

  it('deleting a rule removes its ticks; deleting a trade removes everything', () => {
    const rule = store.createRule('Trend agrees')
    const trade = store.createTrade({ ...input, checklist: [{ rule_id: rule.id, followed: true }] })
    store.deleteRule(rule.id)
    expect(store.getTrade(trade.id)?.checklist).toEqual([])
    expect(store.deleteTrade(trade.id)).toBe(true)
    expect(store.getTrade(trade.id)).toBeUndefined()
    expect(store.updateTrade(trade.id, input)).toBeUndefined()
  })

  it('lists setups by use', () => {
    store.createTrade({ ...input, setup: 'Reclaim' })
    store.createTrade({ ...input, setup: '4H breakout' })
    store.createTrade({ ...input, setup: '4H breakout' })
    expect(store.listSetups()).toEqual(['4H breakout', 'Reclaim'])
  })
})

describe('activity', () => {
  it('stores each day once, sorted', () => {
    store.recordActivity('2026-09-27')
    store.recordActivity('2026-09-26')
    store.recordActivity('2026-09-27')
    expect(store.listActivityDays()).toEqual(['2026-09-26', '2026-09-27'])
  })
})
