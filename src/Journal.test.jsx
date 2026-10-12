import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.js'
import Journal from './Journal.jsx'
import TradeDetail from './TradeDetail.jsx'
import TradeForm from './TradeForm.jsx'

vi.mock('./api.js', async (importOriginal) => {
  const actual = /** @type {typeof import('./api.js')} */ (await importOriginal())
  return {
    ...actual,
    api: {
      listTrades: vi.fn(), getTrade: vi.fn(), createTrade: vi.fn(), updateTrade: vi.fn(), deleteTrade: vi.fn(),
      listRules: vi.fn(), setups: vi.fn(),
    },
  }
})

const openTrade = {
  id: 1, ticker: 'SPY', option_type: 'call', strike: 450, expiration: '2026-10-17', contracts: 2,
  entry_date: '2026-09-20', entry_premium: 2.35, exit_date: null, exit_premium: null, setup: '4H breakout', notes: '',
  created_at: '', updated_at: '', status: 'open', checklist: [], score: null, pnl: null, edits_after_close: 0,
}
const closedTrade = { ...openTrade, status: 'closed', exit_date: '2026-09-25', exit_premium: 2.95, pnl: 120 }

beforeEach(() => {
  vi.mocked(api.listRules).mockResolvedValue([])
  vi.mocked(api.setups).mockResolvedValue(['4H breakout'])
})

afterEach(() => vi.resetAllMocks())

describe('TradeForm', () => {
  it('shows the server error message', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Strike must be a positive number.'))
    render(<TradeForm rules={[]} setups={[]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Ticker'), 'spy')
    await user.click(screen.getByRole('button', { name: 'Save trade' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Strike must be a positive number.')
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ ticker: 'spy', exit_date: null, exit_premium: null, checklist: [] })
  })

  it('sends graded rules only', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const rules = [{ id: 1, text: 'Trend agrees' }, { id: 2, text: 'Invalidation set' }]
    render(<TradeForm rules={rules} setups={[]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.click(within(screen.getByRole('group', { name: 'Trend agrees' })).getByLabelText('Followed'))
    await user.click(screen.getByRole('button', { name: 'Save trade' }))

    expect(onSubmit.mock.calls[0][0].checklist).toEqual([{ rule_id: 1, followed: true }])
  })
})

describe('Journal', () => {
  it('closes an open trade and shows it with P/L', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    vi.mocked(api.listTrades).mockResolvedValueOnce([openTrade]).mockResolvedValueOnce([closedTrade])
    vi.mocked(api.updateTrade).mockResolvedValue(closedTrade)
    render(<Journal onChanged={onChanged} />)

    const openPanel = await screen.findByRole('region', { name: 'Open positions' })
    await user.click(within(openPanel).getByRole('button', { name: 'Close' }))
    await user.clear(screen.getByLabelText('Exit date'))
    await user.type(screen.getByLabelText('Exit date'), '2026-09-25')
    await user.type(screen.getByLabelText('Exit premium'), '2.95')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(api.updateTrade).toHaveBeenCalledWith(1, expect.objectContaining({ exit_date: '2026-09-25', exit_premium: '2.95' }))
    const closedPanel = await screen.findByRole('region', { name: 'Closed trades' })
    expect(await within(closedPanel).findByText('+$120.00')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows days held on closed trades', async () => {
    vi.mocked(api.listTrades).mockResolvedValue([closedTrade])
    render(<Journal onChanged={vi.fn()} />)
    const closedPanel = await screen.findByRole('region', { name: 'Closed trades' })
    expect(within(closedPanel).getByRole('columnheader', { name: 'Held' })).toBeInTheDocument()
    expect(within(closedPanel).getByText('5d')).toBeInTheDocument()
  })

  it('badges trades edited after close', async () => {
    vi.mocked(api.listTrades).mockResolvedValue([{ ...closedTrade, edits_after_close: 2 }])
    render(<Journal onChanged={vi.fn()} />)
    expect(await screen.findByText('EDITED')).toHaveAttribute('title', 'Edited after close (2 changes)')
  })

  it('does not badge an open trade even if it carries edit history', async () => {
    vi.mocked(api.listTrades).mockResolvedValue([{ ...openTrade, edits_after_close: 2 }])
    render(<Journal onChanged={vi.fn()} />)
    const openPanel = await screen.findByRole('region', { name: 'Open positions' })
    expect(within(openPanel).queryByText('EDITED')).not.toBeInTheDocument()
  })

  it('shows an empty state with no trades', async () => {
    vi.mocked(api.listTrades).mockResolvedValue([])
    render(<Journal onChanged={vi.fn()} />)
    expect(await screen.findByText(/No trades yet/)).toBeInTheDocument()
  })

  it('shows when the server is unreachable', async () => {
    vi.mocked(api.listTrades).mockRejectedValue(new Error("Can't reach the journal server."))
    render(<Journal onChanged={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the journal server.")
  })
})

describe('TradeDetail', () => {
  it('reads edit history as date, field, old to new', async () => {
    vi.mocked(api.getTrade).mockResolvedValue({
      ...closedTrade,
      edits: [{ id: 7, trade_id: 1, field: 'exit_premium', old_value: '1.8', new_value: '2.1', edited_at: '2026-09-29T16:00:00.000Z' }],
    })
    render(<TradeDetail id={1} rules={[]} onBack={vi.fn()} onEdit={vi.fn()} />)
    const history = await screen.findByRole('region', { name: 'Edit history' })
    expect(within(history).getByRole('listitem')).toHaveTextContent(/^Sep 29, exit premium 1\.80 to 2\.10$/)
  })

  it('keeps a rule name verbatim inside a checklist edit, only relabeling the field', async () => {
    vi.mocked(api.getTrade).mockResolvedValue({
      ...closedTrade,
      edits: [{ id: 8, trade_id: 1, field: 'checklist: A_rule', old_value: 'not graded', new_value: 'followed', edited_at: '2026-09-29T16:00:00.000Z' }],
    })
    render(<TradeDetail id={1} rules={[]} onBack={vi.fn()} onEdit={vi.fn()} />)
    const history = await screen.findByRole('region', { name: 'Edit history' })
    expect(within(history).getByRole('listitem')).toHaveTextContent(/^Sep 29, checklist: A_rule not graded to followed$/)
  })
})
