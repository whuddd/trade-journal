import { useEffect, useState } from 'react'
import { api, messageOf } from './api.js'
import { contractLabel, money, premium, scoreText, shortDate, tone } from './format.js'

const PREMIUM_FIELDS = new Set(['entry_premium', 'exit_premium'])

/**
 * Local calendar day of an ISO timestamp, e.g. "Sep 29".
 * @param {string} iso
 */
function editDay(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Human-facing label for an edit-history field. Underscores in a plain field
 * name (e.g. "exit_premium") become spaces, but a checklist change carries a
 * rule's own text after "checklist: " and that text must stay verbatim.
 * @param {string} field
 */
function fieldLabel(field) {
  return field.startsWith('checklist: ') ? field : field.replaceAll('_', ' ')
}

/**
 * @param {string} field
 * @param {string | null} value
 */
function editValue(field, value) {
  if (value === null || value === '') return 'blank'
  return PREMIUM_FIELDS.has(field) ? premium(Number(value)) : value
}

/**
 * @param {{id: number, rules: {id: number, text: string}[], onBack: () => void, onEdit: (trade: any) => void}} props
 */
export default function TradeDetail({ id, rules, onBack, onEdit }) {
  const [trade, setTrade] = useState(/** @type {any} */ (null))
  const [error, setError] = useState('')

  useEffect(() => {
    /** @param {KeyboardEvent} event */
    function onKey(event) {
      if (event.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  useEffect(() => {
    api.getTrade(id).then(setTrade).catch((e) => setError(messageOf(e)))
  }, [id])

  if (error) return <section className="panel"><p className="error" role="alert">{error}</p><button type="button" className="btn" onClick={onBack}>Back</button></section>
  if (!trade) return <section className="panel"><p className="empty">Loading...</p></section>

  /** @param {number} ruleId */
  const tickOf = (ruleId) => {
    const tick = trade.checklist.find((/** @type {any} */ c) => c.rule_id === ruleId)
    if (!tick) return { text: 'not graded', cls: 'flat' }
    return tick.followed ? { text: 'followed', cls: 'up' } : { text: 'broken', cls: 'down' }
  }

  const facts = [
    ['Status', trade.status],
    ['Contracts', trade.contracts],
    ['Entry', `${premium(trade.entry_premium)} on ${shortDate(trade.entry_date)}`],
    ['Exit', trade.exit_date ? `${premium(trade.exit_premium)} on ${shortDate(trade.exit_date)}` : '--'],
    ['Setup', trade.setup],
    ['Checklist', scoreText(trade.score)],
  ]

  return (
    <>
      <section className="panel" aria-label="Trade detail">
        <header className="panel-head">
          <button type="button" className="btn" onClick={onBack} title="Back (Esc)">Back</button>
          <h2>{contractLabel(trade)}</h2>
          <span className="spacer" />
          <span className={`detail-pnl ${tone(trade.pnl)}`}>{money(trade.pnl)}</span>
          <button type="button" className="btn" onClick={() => onEdit(trade)}>Edit</button>
        </header>
        <dl className="detail">
          {facts.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        {trade.notes && <p className="panel-body">{trade.notes}</p>}
      </section>

      <section className="panel" aria-label="Checklist">
        <header className="panel-head"><h2>Checklist</h2></header>
        {rules.length === 0 ? <p className="empty">No rules.</p> : (
          <table className="grid">
            <tbody>
              {rules.map((rule) => {
                const tick = tickOf(rule.id)
                return (
                  <tr key={rule.id}>
                    <td>{rule.text}</td>
                    <td className="num"><span className={`tick ${tick.cls}`}>{tick.text}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel" aria-label="Edit history">
        <header className="panel-head"><h2>Edit history</h2><span className="count">{trade.edits.length}</span></header>
        {trade.edits.length === 0 ? (
          <p className="empty">No edits after close.</p>
        ) : (
          <ul className="history">
            {trade.edits.map((/** @type {any} */ edit) => (
              <li key={edit.id}>
                <span className="muted">{editDay(edit.edited_at)},</span>{' '}
                <b>{fieldLabel(edit.field)}</b>{' '}
                {editValue(edit.field, edit.old_value)} <span className="muted">to</span> {editValue(edit.field, edit.new_value)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
