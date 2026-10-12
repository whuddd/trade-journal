import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.js'
import Rules from './Rules.jsx'

vi.mock('./api.js', async (importOriginal) => {
  const actual = /** @type {typeof import('./api.js')} */ (await importOriginal())
  return { ...actual, api: { listRules: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn() } }
})

afterEach(() => vi.resetAllMocks())

describe('Rules', () => {
  it('explains rules when there are none, and adds one', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listRules).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1, text: 'Trend agrees', created_at: '' }])
    vi.mocked(api.createRule).mockResolvedValue({ id: 1, text: 'Trend agrees', created_at: '' })
    render(<Rules />)

    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('New rule'), 'Trend agrees')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(api.createRule).toHaveBeenCalledWith('Trend agrees')
    expect(await screen.findByText('Trend agrees')).toBeInTheDocument()
  })

  it('shows a duplicate error from the server', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listRules).mockResolvedValue([])
    vi.mocked(api.createRule).mockRejectedValue(new Error('That rule already exists.'))
    render(<Rules />)

    await user.type(await screen.findByLabelText('New rule'), 'x')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That rule already exists.')
  })

  it('warns before deleting a rule', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listRules).mockResolvedValueOnce([{ id: 1, text: 'Trend agrees', created_at: '' }]).mockResolvedValueOnce([])
    vi.mocked(api.deleteRule).mockResolvedValue(null)
    render(<Rules />)

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Removes its ticks from past trades.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(api.deleteRule).toHaveBeenCalledWith(1)
  })

  it('shows members the checklist read-only, with nothing to add, rename or delete', async () => {
    vi.mocked(api.listRules).mockResolvedValue([{ id: 1, text: 'Trend agrees', created_at: '' }])
    render(<Rules canEdit={false} />)

    expect(await screen.findByText('Trend agrees')).toBeInTheDocument()
    expect(screen.getByText(/sets this checklist/)).toBeInTheDocument()
    expect(screen.queryByLabelText('New rule')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })
})
