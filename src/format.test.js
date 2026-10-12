import { describe, expect, it } from 'vitest'
import { contractLabel, daysBetween, draftOf, money, percent, scoreText, tone } from './format.js'

describe('format', () => {
  it('signs money', () => {
    expect(money(240)).toBe('+$240.00')
    expect(money(-85)).toBe('-$85.00')
    expect(money(0)).toBe('$0.00')
    expect(money(1234.5)).toBe('+$1,234.50')
    expect(money(null)).toBe('--')
  })
  it('formats percents, tones and scores', () => {
    expect(percent(0.625)).toBe('62.5%')
    expect(percent(null)).toBe('--')
    expect(tone(5)).toBe('up')
    expect(tone(-5)).toBe('down')
    expect(tone(0)).toBe('flat')
    expect(scoreText({ followed: 4, graded: 5, ratio: 0.8 })).toBe('4/5')
    expect(scoreText(null)).toBe('not graded')
  })
  it('labels contracts and counts days', () => {
    expect(contractLabel({ ticker: 'SPY', strike: 450, option_type: 'call', expiration: '2026-10-17' })).toBe('SPY 450C Oct 17')
    expect(daysBetween('2026-09-20', '2026-09-27')).toBe(7)
  })
  it('builds a draft from a trade', () => {
    const trade = {
      id: 1, ticker: 'SPY', option_type: 'put', strike: 440, expiration: '2026-10-17', contracts: 1,
      entry_date: '2026-09-20', entry_premium: 2, exit_date: null, exit_premium: null, setup: 'x', notes: '',
      checklist: [{ rule_id: 1, followed: true }], pnl: null,
    }
    expect(draftOf(trade)).toEqual({
      ticker: 'SPY', option_type: 'put', strike: 440, expiration: '2026-10-17', contracts: 1,
      entry_date: '2026-09-20', entry_premium: 2, exit_date: null, exit_premium: null, setup: 'x', notes: '',
      checklist: [{ rule_id: 1, followed: true }],
    })
  })
})
