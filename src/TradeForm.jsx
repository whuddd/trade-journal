import { useEffect, useRef, useState } from 'react'
import { messageOf } from './api.js'
import { money, shortDate, today, tone, TRADE_FIELDS } from './format.js'

/** @param {Record<string, any> | undefined} initial */
function startValues(initial) {
  if (!initial) {
    return { ticker: '', option_type: 'call', strike: '', expiration: '', contracts: '1', entry_date: today(), entry_premium: '', exit_date: '', exit_premium: '', setup: '', notes: '' }
  }
  return Object.fromEntries(TRADE_FIELDS.map((k) => [k, initial[k] === null || initial[k] === undefined ? '' : String(initial[k])]))
}

/**
 * @param {{
 *   rules: {id: number, text: string}[],
 *   setups: string[],
 *   initial?: Record<string, any>,
 *   onSubmit: (draft: Record<string, any>) => Promise<void>,
 *   onCancel: () => void,
 * }} props
 */
export default function TradeForm({ rules, setups, initial, onSubmit, onCancel }) {
  const [values, setValues] = useState(() => /** @type {Record<string, string>} */ (startValues(initial)))
  const [grades, setGrades] = useState(() => /** @type {Record<number, string>} */ (
    Object.fromEntries((initial?.checklist ?? []).map((/** @type {any} */ c) => [c.rule_id, c.followed ? 'followed' : 'broken']))
  ))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const errorRef = useRef(/** @type {HTMLParagraphElement | null} */ (null))

  // The error sits above the form, so bring it into view after a failed save.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [error])

  /** @param {string} key */
  const bind = (key) => ({
    value: values[key],
    onChange: (/** @type {any} */ e) => setValues((v) => ({ ...v, [key]: e.target.value })),
  })

  useEffect(() => {
    /** @param {KeyboardEvent} event */
    function onKey(event) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  /** @param {import('react').FormEvent} event */
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const checklist = rules
      .filter((r) => grades[r.id] === 'followed' || grades[r.id] === 'broken')
      .map((r) => ({ rule_id: r.id, followed: grades[r.id] === 'followed' }))
    const draft = { ...values, exit_date: values.exit_date || null, exit_premium: values.exit_premium || null, checklist }
    try {
      await onSubmit(draft)
    } catch (e) {
      setError(messageOf(e))
      setSaving(false)
    }
  }

  const num = (/** @type {string} */ key) => (values[key] === '' ? NaN : Number(values[key]))
  const qty = num('contracts')
  const cost = qty * num('entry_premium') * 100
  const pnl = (num('exit_premium') - num('entry_premium')) * qty * 100
  const graded = rules.filter((r) => grades[r.id] === 'followed' || grades[r.id] === 'broken')
  const followed = graded.filter((r) => grades[r.id] === 'followed').length
  const strike = values.strike || '---'
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(values.expiration) ? shortDate(values.expiration) : '--- --'

  return (
    <section className="panel ticket-panel" aria-labelledby="trade-form-title">
      <header className="panel-head">
        <h2 id="trade-form-title">{initial ? `Edit ${initial.ticker}` : 'New trade'}</h2>
        <span className="spacer" />
        <span className="muted hint"><kbd>Esc</kbd> cancel</span>
      </header>
      {error && <p className="error" role="alert" ref={errorRef}>{error}</p>}
      <div className="ticket-layout">
      <form className="form" onSubmit={submit}>
        <label>Ticker<input className="ticker-input" {...bind('ticker')} autoFocus autoComplete="off" /></label>
        <fieldset className="type-toggle">
          <legend>Type</legend>
          {[['call', 'Call'], ['put', 'Put']].map(([value, label]) => (
            <label key={value} className={`type-${value}`}>
              <input type="radio" name="option_type" value={value} checked={values.option_type === value} onChange={() => setValues((v) => ({ ...v, option_type: value }))} />
              {label}
            </label>
          ))}
        </fieldset>
        <label>Strike<input inputMode="decimal" {...bind('strike')} /></label>
        <label>Expiration<input type="date" {...bind('expiration')} /></label>
        <label>Contracts<input inputMode="numeric" {...bind('contracts')} /></label>
        <label>Entry date<input type="date" {...bind('entry_date')} /></label>
        <label>Entry premium<input inputMode="decimal" {...bind('entry_premium')} /></label>
        <label>Exit date<input type="date" {...bind('exit_date')} /></label>
        <label>Exit premium<input inputMode="decimal" {...bind('exit_premium')} /></label>
        <label className="wide">Setup
          <input list="setup-options" placeholder="e.g. 4H breakout" {...bind('setup')} />
          <datalist id="setup-options">{setups.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="wide">Notes<textarea rows={3} placeholder="Why you took it" {...bind('notes')} /></label>
        <fieldset className="checklist">
          <legend>Checklist</legend>
          {rules.length === 0 && <p className="muted">No rules yet. Add some on the Rules tab.</p>}
          {rules.map((rule) => (
            <div key={rule.id} className="rule-row" role="group" aria-label={rule.text}>
              <span>{rule.text}</span>
              <span className="segmented">
                {[['followed', 'Followed'], ['broken', 'Broken'], ['', 'Not graded']].map(([value, label]) => (
                  <label key={label} className={`seg-${value || 'none'}`}>
                    <input
                      type="radio"
                      name={`rule-${rule.id}`}
                      checked={(grades[rule.id] ?? '') === value}
                      onChange={() => setGrades((g) => ({ ...g, [rule.id]: value }))}
                    />
                    {label}
                  </label>
                ))}
              </span>
            </div>
          ))}
        </fieldset>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={saving}>Save trade</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
      <aside className="ticket" aria-label="Order ticket preview">
        <div className="ticket-title">ORDER TICKET</div>
        <div className={`ticket-contract side-${values.option_type}`}>
          <span>{values.ticker ? values.ticker.toUpperCase() : '____'}</span>{' '}
          <span>{strike}{values.option_type === 'call' ? 'C' : 'P'}</span>{' '}
          <span className="muted">{expiry}</span>
        </div>
        <dl>
          <div><dt>Contracts</dt><dd>{Number.isFinite(qty) ? qty : '--'}</dd></div>
          <div><dt>Cost basis</dt><dd>{Number.isFinite(cost) ? money(cost).replace('+', '') : '--'}</dd></div>
          <div><dt>{values.exit_premium ? 'P/L' : 'Status'}</dt>
            <dd className={Number.isFinite(pnl) ? tone(pnl) : ''}>{values.exit_premium ? (Number.isFinite(pnl) ? money(pnl) : '--') : 'OPEN'}</dd>
          </div>
        </dl>
        <div className="ticket-check">
          <div className="ticket-check-head">
            <span>Checklist</span>
            <span>{graded.length ? `${followed}/${graded.length}` : '--'}</span>
          </div>
          <div className="meter" aria-hidden="true">
            {rules.map((r) => <i key={r.id} className={grades[r.id] || 'none'} />)}
          </div>
        </div>
        <div className="ticket-stamp" aria-hidden="true">{initial ? 'AMEND' : 'DRAFT'}</div>
      </aside>
      </div>
    </section>
  )
}
