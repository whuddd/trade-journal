import { useCallback, useEffect, useState } from 'react'
import { api, messageOf } from './api.js'
import ConfirmDelete from './ConfirmDelete.jsx'
import { contractLabel, daysBetween, draftOf, money, percent, premium, scoreText, today, tone } from './format.js'
import { CountUp, isTyping, useToast } from './motion.jsx'
import TradeDetail from './TradeDetail.jsx'
import TradeForm from './TradeForm.jsx'

/** How long a just-saved row keeps the .flash class (matches the CSS animation). */
const FLASH_MS = 900

/** @param {{onChanged: () => void}} props */
export default function Journal({ onChanged }) {
  const [trades, setTrades] = useState(/** @type {any[] | null} */ (null))
  const [rules, setRules] = useState(/** @type {{id: number, text: string}[]} */ ([]))
  const [setups, setSetups] = useState(/** @type {string[]} */ ([]))
  const [error, setError] = useState('')
  const [view, setView] = useState(/** @type {{kind: 'list'} | {kind: 'new'} | {kind: 'edit', trade: any} | {kind: 'detail', id: number}} */ ({ kind: 'list' }))
  const [closing, setClosing] = useState(/** @type {{id: number, exit_date: string, exit_premium: string} | null} */ (null))
  const [flashId, setFlashId] = useState(/** @type {number | null} */ (null))
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [t, r, s] = await Promise.all([api.listTrades(), api.listRules(), api.setups()])
      setTrades(t)
      setRules(r)
      setSetups(s)
      setError('')
    } catch (e) {
      setError(messageOf(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    window.scrollTo?.({ top: 0 })
  }, [view.kind])

  useEffect(() => {
    if (view.kind !== 'list') return
    /** @param {KeyboardEvent} event */
    function onKey(event) {
      if (isTyping(event) || event.key.toLowerCase() !== 'n') return
      event.preventDefault()
      setView({ kind: 'new' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view.kind])

  useEffect(() => {
    if (flashId === null) return
    const timer = setTimeout(() => setFlashId(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flashId])

  /** @param {any} saved the trade the server returned, or null */
  async function afterChange(saved) {
    await load()
    setFlashId(saved?.id ?? null)
    onChanged()
  }

  /** @param {Record<string, any>} draft */
  async function save(draft) {
    const editing = view.kind === 'edit'
    const saved = editing ? await api.updateTrade(view.trade.id, draft) : await api.createTrade(draft)
    setView({ kind: 'list' })
    await afterChange(saved)
    if (saved?.ticker) toast(`${editing ? 'Updated' : 'Logged'} ${contractLabel(saved)}`, 'up')
  }

  /**
   * @param {import('react').FormEvent} event
   * @param {any} trade
   */
  async function submitClose(event, trade) {
    event.preventDefault()
    if (!closing) return
    try {
      const saved = await api.updateTrade(trade.id, { ...draftOf(trade), exit_date: closing.exit_date, exit_premium: closing.exit_premium })
      setClosing(null)
      await afterChange(saved)
      if (saved?.ticker) toast(`Closed ${contractLabel(saved)} · ${money(saved.pnl)}`, saved.pnl < 0 ? 'down' : 'up')
    } catch (e) {
      setError(messageOf(e))
    }
  }

  /** @param {number} id */
  async function remove(id) {
    try {
      await api.deleteTrade(id)
      await afterChange(null)
      toast('Trade deleted', 'info')
    } catch (e) {
      setError(messageOf(e))
    }
  }

  if (view.kind === 'new' || view.kind === 'edit') {
    return (
      <TradeForm
        rules={rules}
        setups={setups}
        initial={view.kind === 'edit' ? view.trade : undefined}
        onSubmit={save}
        onCancel={() => setView({ kind: 'list' })}
      />
    )
  }
  if (view.kind === 'detail') {
    return <TradeDetail id={view.id} rules={rules} onBack={() => setView({ kind: 'list' })} onEdit={(trade) => setView({ kind: 'edit', trade })} />
  }

  const open = trades?.filter((t) => t.status === 'open') ?? []
  const closed = trades?.filter((t) => t.status === 'closed') ?? []

  /** @param {any} t */
  const rowClass = (t) => (t.id === flashId ? 'flash' : undefined)
  /** @param {number} i */
  const stagger = (i) => /** @type {import('react').CSSProperties} */ ({ '--i': Math.min(i, 12) })

  const atRisk = open.reduce((sum, t) => sum + t.entry_premium * t.contracts * 100, 0)
  const realized = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  const wins = closed.filter((t) => t.pnl > 0).length
  const biggest = Math.max(1, ...closed.map((t) => Math.abs(t.pnl ?? 0)))

  /** @param {any} t */
  const contractCell = (t) => (
    <td data-label="Contract">
      <span className={`side side-${t.option_type}`} aria-hidden="true">{t.option_type === 'call' ? 'C' : 'P'}</span>
      <button type="button" className="link" onClick={() => setView({ kind: 'detail', id: t.id })}>{contractLabel(t)}</button>
      {t.status === 'closed' && t.edits_after_close > 0 && (
        <span className="badge" title={`Edited after close (${t.edits_after_close} ${t.edits_after_close === 1 ? 'change' : 'changes'})`}>EDITED</span>
      )}
    </td>
  )

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="prompt" aria-hidden="true">
        <span className="prompt-path">~/journal</span> <span className="slash">$</span>{' '}
        <span className="typed" style={{ '--chars': 18 }}>ls --open --closed</span>
      </div>

      {trades && trades.length > 0 && (
        <div className="summary" aria-label="Summary">
          <div className="sum-cell">
            <span className="label">Open</span>
            <span className="value"><CountUp value={open.length} format={(v) => String(Math.round(v ?? 0))} /></span>
          </div>
          <div className="sum-cell">
            <span className="label">Premium at risk</span>
            <span className="value"><CountUp value={atRisk} format={(v) => money(v).replace('+', '')} /></span>
          </div>
          <div className="sum-cell">
            <span className="label">Realized P/L</span>
            <span className={`value ${tone(realized)}`}><CountUp value={realized} format={money} /></span>
          </div>
          <div className="sum-cell">
            <span className="label">Win rate</span>
            <span className="value">{closed.length ? <CountUp value={wins / closed.length} format={percent} /> : '--'}</span>
            {closed.length > 0 && (
              <span className="winbar" aria-hidden="true"><span style={{ width: `${(wins / closed.length) * 100}%` }} /></span>
            )}
          </div>
        </div>
      )}

      <section className="panel" aria-labelledby="open-title">
        <header className="panel-head">
          <h2 id="open-title">Open positions</h2>
          <span className="count">{open.length}</span>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={() => setView({ kind: 'new' })} title="New trade (N)">+ New trade</button>
        </header>
        {trades && trades.length === 0 && (
          <div className="empty empty-art">
            <pre aria-hidden="true">{'   ┌──────────────┐\n   │  _           │\n   │ | |  no data │\n   └──────────────┘'}</pre>
            <p>No trades yet. Log your first one with + New trade, or press <kbd>N</kbd>.</p>
          </div>
        )}
        {trades && trades.length > 0 && open.length === 0 && <p className="empty">No open trades.</p>}
        {open.length > 0 && (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th>Contract</th><th className="num">Qty</th><th className="num">Entry</th><th className="num">Held</th><th>Setup</th><th /></tr>
              </thead>
              <tbody>
                {open.map((t, i) => (
                  <tr key={t.id} className={rowClass(t)} style={stagger(i)}>
                    {contractCell(t)}
                    <td data-label="Qty" className="num">{t.contracts}</td>
                    <td data-label="Entry" className="num">{premium(t.entry_premium)}</td>
                    <td data-label="Held" className="num">{daysBetween(t.entry_date, today())}d</td>
                    <td data-label="Setup">{t.setup}</td>
                    <td className="actions">
                      {closing?.id === t.id ? (
                        <form className="inline close-form" onSubmit={(e) => submitClose(e, t)}>
                          <input aria-label="Exit date" type="date" value={closing.exit_date} onChange={(e) => setClosing({ ...closing, exit_date: e.target.value })} />
                          <input aria-label="Exit premium" inputMode="decimal" placeholder="Exit" autoFocus value={closing.exit_premium} onChange={(e) => setClosing({ ...closing, exit_premium: e.target.value })} />
                          <button type="submit">Save</button>
                          <button type="button" onClick={() => setClosing(null)}>Cancel</button>
                        </form>
                      ) : (
                        <div className="action-row">
                          <button type="button" onClick={() => setClosing({ id: t.id, exit_date: today(), exit_premium: '' })}>Close</button>
                          <button type="button" onClick={() => setView({ kind: 'edit', trade: t })}>Edit</button>
                          <ConfirmDelete onConfirm={() => remove(t.id)} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {closed.length > 0 && (
        <section className="panel" aria-labelledby="closed-title">
          <header className="panel-head">
            <h2 id="closed-title">Closed trades</h2>
            <span className="count">{closed.length}</span>
          </header>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr><th>Contract</th><th className="num">Qty</th><th className="num">Entry</th><th className="num">Exit</th><th className="num">Held</th><th className="num">P/L</th><th className="num">Score</th><th>Setup</th><th /></tr>
              </thead>
              <tbody>
                {closed.map((t, i) => (
                  <tr key={t.id} className={rowClass(t)} style={stagger(i)}>
                    {contractCell(t)}
                    <td data-label="Qty" className="num">{t.contracts}</td>
                    <td data-label="Entry" className="num">{premium(t.entry_premium)}</td>
                    <td data-label="Exit" className="num">{premium(t.exit_premium)}</td>
                    <td data-label="Held" className="num">{daysBetween(t.entry_date, t.exit_date)}d</td>
                    <td data-label="P/L" className={`num pnl ${tone(t.pnl)}`} style={{ '--mag': `${(Math.abs(t.pnl ?? 0) / biggest) * 100}%` }}>{money(t.pnl)}</td>
                    <td data-label="Score" className="num"><Pips score={t.score} />{scoreText(t.score)}</td>
                    <td data-label="Setup">{t.setup}</td>
                    <td className="actions">
                      <div className="action-row">
                        <button type="button" onClick={() => setView({ kind: 'edit', trade: t })}>Edit</button>
                        <ConfirmDelete onConfirm={() => remove(t.id)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

/**
 * One pip per graded rule, lit when followed. Decorative; the text beside it
 * carries the same information.
 * @param {{score: {followed: number, graded: number} | null}} props
 */
function Pips({ score }) {
  if (!score) return null
  return (
    <span className="pips" aria-hidden="true">
      {Array.from({ length: score.graded }, (_, i) => <i key={i} className={i < score.followed ? 'on' : ''} />)}
    </span>
  )
}
