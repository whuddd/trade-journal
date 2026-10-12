// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addDays, checklistScore, computeStats, diffTrade, isDay, localDay, streaks, tradePnl, validateRule, validateTrade } from './journal.js'

const base = {
  ticker: ' spy ',
  option_type: 'call',
  strike: '450',
  expiration: '2026-10-17',
  contracts: '2',
  entry_date: '2026-09-20',
  entry_premium: '2.35',
  exit_date: null,
  exit_premium: null,
  setup: ' 4H breakout ',
  notes: 'Weekly reclaim.',
  checklist: [{ rule_id: 2, followed: false }, { rule_id: 1, followed: true }],
}

describe('isDay', () => {
  it('accepts real dates and rejects others', () => {
    expect(isDay('2026-02-28')).toBe(true)
    expect(isDay('2026-02-30')).toBe(false)
    expect(isDay('9/20/2026')).toBe(false)
    expect(isDay(undefined)).toBe(false)
  })
})

describe('validateTrade', () => {
  it('normalizes a valid open trade', () => {
    const result = validateTrade(base)
    expect(result).toEqual({
      ok: true,
      value: {
        ticker: 'SPY',
        option_type: 'call',
        strike: 450,
        expiration: '2026-10-17',
        contracts: 2,
        entry_date: '2026-09-20',
        entry_premium: 2.35,
        exit_date: null,
        exit_premium: null,
        setup: '4H breakout',
        notes: 'Weekly reclaim.',
        checklist: [{ rule_id: 1, followed: true }, { rule_id: 2, followed: false }],
      },
    })
  })

  it('accepts a closed trade and treats empty strings as no exit', () => {
    expect(validateTrade({ ...base, exit_date: '2026-09-25', exit_premium: '3.10' }).value).toMatchObject({ exit_date: '2026-09-25', exit_premium: 3.1 })
    expect(validateTrade({ ...base, exit_date: '', exit_premium: '' }).value).toMatchObject({ exit_date: null, exit_premium: null })
  })

  it('accepts tickers with a class dot', () => {
    expect(validateTrade({ ...base, ticker: 'brk.b' }).value?.ticker).toBe('BRK.B')
  })

  it.each([
    [{ ticker: '' }, 'Ticker must be 1 to 10 letters, like SPY or BRK.B.'],
    [{ ticker: 'SPY1' }, 'Ticker must be 1 to 10 letters, like SPY or BRK.B.'],
    [{ option_type: 'straddle' }, 'Option type must be call or put.'],
    [{ strike: '0' }, 'Strike must be a positive number.'],
    [{ strike: 'abc' }, 'Strike must be a positive number.'],
    [{ expiration: '2026-13-01' }, 'Expiration must be a date (YYYY-MM-DD).'],
    [{ contracts: '1.5' }, 'Contracts must be a whole number of at least 1.'],
    [{ contracts: '0' }, 'Contracts must be a whole number of at least 1.'],
    [{ entry_date: '' }, 'Entry date must be a date (YYYY-MM-DD).'],
    [{ entry_premium: '-1' }, 'Entry premium must be 0 or more.'],
    [{ exit_date: '2026-09-25' }, 'Exit date and exit premium go together.'],
    [{ exit_premium: '1.00' }, 'Exit date and exit premium go together.'],
    [{ exit_date: '2026-09-19', exit_premium: '1' }, "Exit date can't be before entry date."],
    [{ exit_date: '2026-09-25', exit_premium: '-2' }, 'Exit premium must be 0 or more.'],
    [{ setup: '   ' }, 'Setup is required.'],
    [{ setup: 'x'.repeat(61) }, 'Setup must be 60 characters or fewer.'],
    [{ notes: 'x'.repeat(2001) }, 'Notes must be 2,000 characters or fewer.'],
    [{ checklist: 'yes' }, 'Checklist must be a list.'],
    [{ checklist: [{ rule_id: 'a', followed: true }] }, 'Each checklist entry needs a rule_id.'],
    [{ checklist: [{ rule_id: 1, followed: 'yes' }] }, 'Each checklist entry needs followed: true or false.'],
    [{ checklist: [{ rule_id: 1, followed: true }, { rule_id: 1, followed: false }] }, 'A rule can only be graded once per trade.'],
  ])('rejects %j', (patch, error) => {
    expect(validateTrade({ ...base, ...patch })).toEqual({ ok: false, error })
  })

  it('rejects a missing body', () => {
    expect(validateTrade(undefined).ok).toBe(false)
  })
})

describe('validateRule', () => {
  it('trims text', () => {
    expect(validateRule({ text: '  Defined invalidation  ' })).toEqual({ ok: true, value: { text: 'Defined invalidation' } })
  })
  it('rejects empty and long text', () => {
    expect(validateRule({ text: ' ' })).toEqual({ ok: false, error: 'Rule text is required.' })
    expect(validateRule({ text: 'x'.repeat(121) })).toEqual({ ok: false, error: 'Rule text must be 120 characters or fewer.' })
  })
})

describe('tradePnl', () => {
  it('is null while open', () => {
    expect(tradePnl({ entry_premium: 2, exit_premium: null, contracts: 1 })).toBeNull()
  })
  it('computes wins and losses in dollars, for calls and puts alike', () => {
    expect(tradePnl({ entry_premium: 2.35, exit_premium: 3.1, contracts: 2 })).toBe(150)
    expect(tradePnl({ entry_premium: 1.2, exit_premium: 0.35, contracts: 3 })).toBe(-255)
  })
})

describe('checklistScore', () => {
  it('is null with no graded rules', () => {
    expect(checklistScore([])).toBeNull()
  })
  it('counts followed over graded', () => {
    expect(checklistScore([{ rule_id: 1, followed: true }, { rule_id: 2, followed: false }])).toEqual({ followed: 1, graded: 2, ratio: 0.5 })
  })
})

const closedBefore = {
  ticker: 'SPY', option_type: 'call', strike: 450, expiration: '2026-10-17', contracts: 2,
  entry_date: '2026-09-20', entry_premium: 2.35, exit_date: '2026-09-25', exit_premium: 3.1,
  setup: '4H breakout', notes: '', checklist: [{ rule_id: 1, followed: true }],
}

describe('diffTrade', () => {
  const ruleText = new Map([[1, 'Trend agrees'], [2, 'Defined invalidation']])

  it('returns nothing when nothing changed', () => {
    expect(diffTrade(closedBefore, { ...closedBefore }, ruleText)).toEqual([])
  })

  it('reports changed fields as strings', () => {
    expect(diffTrade(closedBefore, { ...closedBefore, exit_premium: 3.4, notes: 'late fill' }, ruleText)).toEqual([
      { field: 'exit_premium', old_value: '3.1', new_value: '3.4' },
      { field: 'notes', old_value: '', new_value: 'late fill' },
    ])
  })

  it('reports reopening as exit fields going blank', () => {
    expect(diffTrade(closedBefore, { ...closedBefore, exit_date: null, exit_premium: null }, ruleText)).toEqual([
      { field: 'exit_date', old_value: '2026-09-25', new_value: '' },
      { field: 'exit_premium', old_value: '3.1', new_value: '' },
    ])
  })

  it('reports checklist changes by rule text', () => {
    const after = { ...closedBefore, checklist: [{ rule_id: 1, followed: false }, { rule_id: 2, followed: true }] }
    expect(diffTrade(closedBefore, after, ruleText)).toEqual([
      { field: 'checklist: Trend agrees', old_value: 'followed', new_value: 'broken' },
      { field: 'checklist: Defined invalidation', old_value: 'not graded', new_value: 'followed' },
    ])
  })
})

describe('days and streaks', () => {
  it('formats days in Detroit time, whatever the server clock zone', () => {
    // 11 PM in Detroit on Oct 12 is 03:00 UTC on Oct 13
    expect(localDay(new Date('2026-10-13T03:00:00Z'))).toBe('2026-10-12')
    expect(localDay(new Date('2026-10-13T05:00:00Z'))).toBe('2026-10-13')
    expect(localDay(new Date('2026-10-13T03:00:00Z'), 'UTC')).toBe('2026-10-13')
  })

  it('adds days across months', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('is zero with no days', () => {
    expect(streaks([], '2026-09-27')).toEqual({ current_streak: 0, longest_streak: 0 })
  })

  it('counts a run ending today', () => {
    expect(streaks(['2026-09-25', '2026-09-26', '2026-09-27'], '2026-09-27')).toEqual({ current_streak: 3, longest_streak: 3 })
  })

  it('keeps the streak alive when only today is missing', () => {
    expect(streaks(['2026-09-25', '2026-09-26'], '2026-09-27').current_streak).toBe(2)
  })

  it('breaks the streak after a missed day, but remembers the longest', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-24', '2026-09-25']
    expect(streaks(days, '2026-09-27')).toEqual({ current_streak: 0, longest_streak: 4 })
  })
})

/**
 * @param {number} id
 * @param {Partial<{option_type: string, setup: string, pnl: number | null, exit_date: string | null, checklist: {rule_id: number, followed: boolean}[], edits: number}>} o
 */
function t(id, o) {
  const checklist = o.checklist ?? []
  return {
    id,
    option_type: o.option_type ?? 'call',
    setup: o.setup ?? 'A',
    exit_date: o.exit_date ?? null,
    pnl: o.pnl ?? null,
    checklist,
    score: checklistScore(checklist),
    edits_after_close: o.edits ?? 0,
  }
}

const statsFixture = [
  t(1, { pnl: 100, exit_date: '2026-09-01', checklist: [{ rule_id: 1, followed: true }] }),
  t(2, { pnl: -50, exit_date: '2026-09-02', checklist: [{ rule_id: 1, followed: false }], edits: 1 }),
  t(3, { option_type: 'put', pnl: 30, exit_date: '2026-09-03', checklist: [{ rule_id: 1, followed: true }] }),
  t(4, { option_type: 'put', setup: 'B', pnl: 0, exit_date: '2026-09-04' }),
  t(5, { setup: 'B' }),
]
const statsRules = [{ id: 1, text: 'Trend agrees' }, { id: 2, text: 'Unused rule' }]

describe('computeStats', () => {
  const stats = computeStats(statsFixture, statsRules)

  it('summarizes closed trades only', () => {
    expect(stats.overview).toEqual({ n: 4, win_rate: 0.5, total_pnl: 80, avg_win: 65, avg_loss: -50, expectancy: 20 })
  })

  it('splits calls and puts', () => {
    expect(stats.by_type).toEqual({
      call: { n: 2, win_rate: 0.5, total_pnl: 50, avg_pnl: 25 },
      put: { n: 2, win_rate: 0.5, total_pnl: 30, avg_pnl: 15 },
    })
  })

  it('builds the cumulative curve in exit order', () => {
    expect(stats.curve.map((p) => p.cumulative)).toEqual([100, 50, 80, 80])
  })

  it('groups by setup, sorted by total P/L, best and worst need 3 trades', () => {
    expect(stats.by_setup.map((s) => s.setup)).toEqual(['A', 'B'])
    expect(stats.by_setup[0]).toMatchObject({ n: 3, total_pnl: 80, avg_pnl: 26.67 })
    expect(stats.by_setup[0].win_rate).toBeCloseTo(2 / 3)
    expect(stats.best_setup).toBe('A')
    expect(stats.worst_setup).toBeNull()
  })

  it('compares followed and broken per rule', () => {
    expect(stats.rules).toEqual([
      {
        rule_id: 1, text: 'Trend agrees',
        followed: { n: 2, win_rate: 1, total_pnl: 130, avg_pnl: 65 },
        broken: { n: 1, win_rate: 0, total_pnl: -50, avg_pnl: -50 },
        edge: 115,
      },
      {
        rule_id: 2, text: 'Unused rule',
        followed: { n: 0, win_rate: null, total_pnl: 0, avg_pnl: null },
        broken: { n: 0, win_rate: null, total_pnl: 0, avg_pnl: null },
        edge: null,
      },
    ])
  })

  it('compares disciplined trades with the rest, skipping ungraded', () => {
    expect(stats.discipline).toEqual({
      disciplined: { n: 2, win_rate: 1, total_pnl: 130, avg_pnl: 65 },
      rest: { n: 1, win_rate: 0, total_pnl: -50, avg_pnl: -50 },
    })
  })

  it('counts closed trades edited after close', () => {
    expect(stats.honesty).toEqual({ edited: 1, closed: 4, share: 0.25, trade_ids: [2] })
  })

  it('returns the full shape with no closed trades', () => {
    const empty = computeStats([t(9, {})], [])
    expect(empty.overview).toEqual({ n: 0, win_rate: null, total_pnl: 0, avg_win: null, avg_loss: null, expectancy: null })
    expect(empty.curve).toEqual([])
    expect(empty.honesty).toEqual({ edited: 0, closed: 0, share: null, trade_ids: [] })
  })

  it('names a worst setup once two setups qualify', () => {
    const more = [...statsFixture, t(6, { setup: 'B', pnl: -10, exit_date: '2026-09-05' }), t(7, { setup: 'B', pnl: -20, exit_date: '2026-09-06' })]
    const s = computeStats(more, statsRules)
    expect(s.best_setup).toBe('A')
    expect(s.worst_setup).toBe('B')
  })
})
