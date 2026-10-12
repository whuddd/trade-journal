import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.js'
import Stats from './Stats.jsx'

vi.mock('./api.js', async (importOriginal) => {
  const actual = /** @type {typeof import('./api.js')} */ (await importOriginal())
  return { ...actual, api: { stats: vi.fn(), listTrades: vi.fn() } }
})

afterEach(() => vi.resetAllMocks())

const summary = (n, win_rate, total_pnl, avg_pnl) => ({ n, win_rate, total_pnl, avg_pnl })

const stats = {
  overview: { n: 4, win_rate: 0.5, total_pnl: 80, avg_win: 65, avg_loss: -50, expectancy: 20 },
  by_type: { call: summary(2, 0.5, 50, 25), put: summary(2, 0.5, 30, 15) },
  curve: [
    { id: 1, exit_date: '2026-09-01', pnl: 100, cumulative: 100 },
    { id: 2, exit_date: '2026-09-02', pnl: -150, cumulative: -50 },
    { id: 3, exit_date: '2026-09-03', pnl: 130, cumulative: 80 },
  ],
  by_setup: [{ setup: '4H breakout', ...summary(3, 2 / 3, 80, 26.67) }],
  best_setup: '4H breakout',
  worst_setup: null,
  rules: [{ rule_id: 1, text: 'Trend agrees', followed: summary(2, 1, 130, 65), broken: summary(1, 0, -50, -50), edge: 115 }],
  discipline: { disciplined: summary(2, 1, 130, 65), rest: summary(1, 0, -50, -50) },
  honesty: { edited: 1, closed: 4, share: 0.25, trade_ids: [2] },
}

const trades = [
  { id: 1, ticker: 'AAPL', strike: 190, option_type: 'call', expiration: '2026-09-19' },
  { id: 2, ticker: 'SPY', strike: 450, option_type: 'put', expiration: '2026-09-10' },
  { id: 3, ticker: 'TSLA', strike: 220, option_type: 'call', expiration: '2026-09-25' },
  { id: 4, ticker: 'QQQ', strike: 380, option_type: 'put', expiration: '2026-09-04' },
]

describe('Stats', () => {
  it('shows an empty state before any trade is closed', async () => {
    vi.mocked(api.stats).mockResolvedValue({ ...stats, overview: { ...stats.overview, n: 0 } })
    vi.mocked(api.listTrades).mockResolvedValue(trades)
    render(<Stats />)
    expect(await screen.findByText(/Close a trade to see stats/)).toBeInTheDocument()
  })

  it('shows totals, rule edge, discipline and honesty', async () => {
    vi.mocked(api.stats).mockResolvedValue(stats)
    vi.mocked(api.listTrades).mockResolvedValue(trades)
    render(<Stats />)
    const totals = await screen.findByRole('region', { name: 'Overview' })
    expect(within(totals).getAllByText('+$80.00')[0]).toBeInTheDocument()
    expect(screen.getByText('+$115.00')).toBeInTheDocument()
    expect(screen.getByText('Trend agrees')).toBeInTheDocument()
    expect(screen.getByText(/1 of 4 closed trades \(25\.0%\)/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Cumulative P\/L over 3 closed trades, ending at \+\$80\.00/ })).toBeInTheDocument()
  })

  it('shows the win rate for both the followed and broken side of a rule', async () => {
    vi.mocked(api.stats).mockResolvedValue(stats)
    vi.mocked(api.listTrades).mockResolvedValue(trades)
    render(<Stats />)
    const row = (await screen.findByText('Trend agrees')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(/** @type {HTMLElement} */ (row)).getByText(/win 100\.0%/)).toBeInTheDocument()
    expect(within(/** @type {HTMLElement} */ (row)).getByText(/win 0\.0%/)).toBeInTheDocument()
  })

  it('shows edited trades by contract label, not by id', async () => {
    vi.mocked(api.stats).mockResolvedValue(stats)
    vi.mocked(api.listTrades).mockResolvedValue(trades)
    render(<Stats />)
    expect(await screen.findByText(/Trades: SPY 450P Sep 10/)).toBeInTheDocument()
    expect(screen.queryByText(/#2/)).not.toBeInTheDocument()
  })

  it('falls back to the id when a trade behind an edit no longer exists', async () => {
    vi.mocked(api.stats).mockResolvedValue(stats)
    vi.mocked(api.listTrades).mockResolvedValue([])
    render(<Stats />)
    expect(await screen.findByText(/Trades: #2/)).toBeInTheDocument()
  })
})
