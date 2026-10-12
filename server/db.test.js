// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStore } from './db.js'
import { MIGRATIONS, migrate } from './migrations.js'
import { pgliteDb } from './pg.js'

/** @type {ReturnType<typeof createStore>} */
let store
let uid = 0

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
  uid = (await store.upsertUser({ github_id: 1, login: 'me', name: null, avatar_url: null })).id
})

afterEach(async () => {
  await store.close()
})

describe('migrations', () => {
  it('apply once and are recorded', async () => {
    const db = await pgliteDb()
    expect(await migrate(db)).toEqual([1, 2])
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
    const trade = await store.createTrade(uid, { ...input, checklist: [{ rule_id: rule.id, followed: true }] })
    expect(trade).toMatchObject({
      ticker: 'SPY', status: 'open', pnl: null, edits_after_close: 0, edits: [],
      checklist: [{ rule_id: rule.id, followed: true }], score: { followed: 1, graded: 1, ratio: 1 },
    })
  })

  it('lists open trades first, then closed, newest entry first', async () => {
    const a = await store.createTrade(uid, { ...input, entry_date: '2026-09-01', exit_date: '2026-09-02', exit_premium: 3 })
    const b = await store.createTrade(uid, { ...input, entry_date: '2026-09-10' })
    const c = await store.createTrade(uid, { ...input, entry_date: '2026-09-05', exit_date: '2026-09-06', exit_premium: 1 })
    expect((await store.listTrades(uid)).map((t) => t.id)).toEqual([b.id, c.id, a.id])
  })

  it('does not record edits while open, including the edit that closes it', async () => {
    const trade = await store.createTrade(uid, input)
    await store.updateTrade(uid, trade.id, { ...input, notes: 'changed' })
    const closed = await store.updateTrade(uid, trade.id, { ...input, notes: 'changed', exit_date: '2026-09-25', exit_premium: 3.1 })
    expect(closed?.edits).toEqual([])
    expect(closed?.pnl).toBe(150)
  })

  it('records each change to a closed trade, newest first', async () => {
    const rule = await store.createRule('Trend agrees')
    const closedInput = { ...input, exit_date: '2026-09-25', exit_premium: 3.1, checklist: [{ rule_id: rule.id, followed: true }] }
    const trade = await store.createTrade(uid, closedInput)
    await store.updateTrade(uid, trade.id, { ...closedInput, exit_premium: 3.4 })
    const after = await store.updateTrade(uid, trade.id, { ...closedInput, exit_premium: 3.4, checklist: [{ rule_id: rule.id, followed: false }] })
    expect(after?.edits.map((e) => [e.field, e.old_value, e.new_value])).toEqual([
      ['checklist: Trend agrees', 'followed', 'broken'],
      ['exit_premium', '3.1', '3.4'],
    ])
    expect(after?.edits_after_close).toBe(2)
    expect((await store.listTrades(uid))[0].edits_after_close).toBe(2)
  })

  it('deleting a rule removes its ticks; deleting a trade removes everything', async () => {
    const rule = await store.createRule('Trend agrees')
    const trade = await store.createTrade(uid, { ...input, checklist: [{ rule_id: rule.id, followed: true }] })
    await store.deleteRule(rule.id)
    expect((await store.getTrade(uid, trade.id))?.checklist).toEqual([])
    expect(await store.deleteTrade(uid, trade.id)).toBe(true)
    expect(await store.getTrade(uid, trade.id)).toBeUndefined()
    expect(await store.updateTrade(uid, trade.id, input)).toBeUndefined()
  })

  it('rolls back a trade whose checklist names a missing rule', async () => {
    await expect(store.createTrade(uid, { ...input, checklist: [{ rule_id: 42, followed: true }] })).rejects.toThrow()
    expect(await store.listTrades(uid)).toEqual([])
  })

  it('lists setups by use', async () => {
    await store.createTrade(uid, { ...input, setup: 'Reclaim' })
    await store.createTrade(uid, { ...input, setup: '4H breakout' })
    await store.createTrade(uid, { ...input, setup: '4H breakout' })
    expect(await store.listSetups(uid)).toEqual(['4H breakout', 'Reclaim'])
  })
})

describe('activity', () => {
  it('stores each day once, sorted', async () => {
    await store.recordActivity(uid, '2026-09-27')
    await store.recordActivity(uid, '2026-09-26')
    await store.recordActivity(uid, '2026-09-27')
    expect(await store.listActivityDays(uid)).toEqual(['2026-09-26', '2026-09-27'])
  })
})

describe('users and sessions', () => {
  it('updates a returning user\'s profile instead of adding a second user', async () => {
    const again = await store.upsertUser({ github_id: 1, login: 'renamed', name: 'Me', avatar_url: null })
    expect(again).toMatchObject({ id: uid, login: 'renamed', name: 'Me' })
  })

  it('finds a live session by its hash, and not an expired or deleted one', async () => {
    await store.createSession('live', uid, '2099-01-01T00:00:00.000Z')
    await store.createSession('stale', uid, '2026-01-01T00:00:00.000Z')
    expect((await store.sessionUser('live'))?.id).toBe(uid)
    expect(await store.sessionUser('stale')).toBeUndefined()
    await store.deleteSession('live')
    expect(await store.sessionUser('live')).toBeUndefined()
  })
})

describe('migration 2 on a Part A database', () => {
  it('keeps every Part A row, and the owner claims them on sign-in', async () => {
    const db = await pgliteDb()
    await migrate(db, MIGRATIONS.slice(0, 1))
    // Part A rows, written the way the Part A code wrote them: no user anywhere
    const [{ id: ruleId }] = await db.query("INSERT INTO rules (text, created_at) VALUES ('Trend agrees', 'x') RETURNING id")
    const [{ id: tradeId }] = await db.query(
      `INSERT INTO trades (ticker, option_type, strike, expiration, contracts, entry_date, entry_premium, setup, notes, created_at, updated_at)
       VALUES ('SPY', 'call', 450, '2026-10-17', 2, '2026-10-01', 2.35, 'Reclaim', '', 'x', 'x') RETURNING id`,
    )
    await db.query('INSERT INTO trade_rules (trade_id, rule_id, followed) VALUES ($1, $2, true)', [tradeId, ruleId])
    await db.query("INSERT INTO activity_days (day) VALUES ('2026-10-01')")

    expect(await migrate(db)).toEqual([2])
    const partB = createStore(db)
    const owner = await partB.upsertUser({ github_id: 7, login: 'owner', name: null, avatar_url: null })
    const member = await partB.upsertUser({ github_id: 8, login: 'member', name: null, avatar_url: null })
    expect(await partB.listTrades(owner.id)).toEqual([])

    expect(await partB.claimOrphans(owner.id)).toBe(1)
    const [kept] = await partB.listTrades(owner.id)
    expect(kept).toMatchObject({ id: Number(tradeId), ticker: 'SPY', checklist: [{ rule_id: Number(ruleId), followed: true }] })
    expect(await partB.listActivityDays(owner.id)).toEqual(['2026-10-01'])
    expect(await partB.listRules()).toMatchObject([{ text: 'Trend agrees' }])
    expect(await partB.listTrades(member.id)).toEqual([])
    expect(await partB.claimOrphans(owner.id)).toBe(0)
    await partB.close()
  })
})
