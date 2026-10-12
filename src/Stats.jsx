import { useEffect, useState } from 'react'
import { api, messageOf } from './api.js'
import { contractLabel, money, percent, tone } from './format.js'
import { CountUp } from './motion.jsx'
import PnlChart from './PnlChart.jsx'

/**
 * @param {{label: string, value: number | null | undefined, format: (v: number | null | undefined) => string, cls?: string, n?: number}} props
 */
function Tile({ label, value, format, cls = '', n }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className={`value ${cls}`}><CountUp value={value} format={format} /></div>
      {n !== undefined && <div className="n">n = {n}</div>}
    </div>
  )
}

/** @param {{title: string, children: import('react').ReactNode, extra?: import('react').ReactNode}} props */
function Panel({ title, children, extra }) {
  return (
    <section className="panel" aria-label={title}>
      <header className="panel-head"><h2>{title}</h2><span className="spacer" />{extra}</header>
      {children}
    </section>
  )
}

export default function Stats() {
  const [stats, setStats] = useState(/** @type {any} */ (null))
  const [trades, setTrades] = useState(/** @type {any[]} */ ([]))
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.stats(), api.listTrades()])
      .then(([s, t]) => {
        setStats(s)
        setTrades(t)
      })
      .catch((e) => setError(messageOf(e)))
  }, [])

  if (error) return <p className="error" role="alert">{error}</p>
  if (!stats) return <section className="panel"><p className="empty">Loading...</p></section>

  const o = stats.overview
  const maxEdge = Math.max(1, ...stats.rules.map((/** @type {any} */ r) => Math.abs(r.edge ?? 0)))
  if (o.n === 0) {
    return (
      <Panel title="Stats">
        <p className="empty">Close a trade to see stats. Stats only count closed trades.</p>
      </Panel>
    )
  }

  return (
    <>
      <Panel title="Overview" extra={<span className="count">n = {o.n}</span>}>
        <div className="tiles">
          <Tile label="Total P/L" value={o.total_pnl} format={money} cls={tone(o.total_pnl)} />
          <Tile label="Win rate" value={o.win_rate} format={percent} />
          <Tile label="Expectancy" value={o.expectancy} format={money} cls={tone(o.expectancy)} />
          <Tile label="Avg win" value={o.avg_win} format={money} cls="up" />
          <Tile label="Avg loss" value={o.avg_loss} format={money} cls="down" />
        </div>
        <table className="grid">
          <thead><tr><th>Type</th><th className="num">n</th><th className="num">Win rate</th><th className="num">Total</th></tr></thead>
          <tbody>
            {[['Calls', stats.by_type.call], ['Puts', stats.by_type.put]].map(([label, s]) => (
              <tr key={label}>
                <td data-label="Type">{label}</td>
                <td data-label="n" className="num">{s.n}</td>
                <td data-label="Win rate" className="num">{percent(s.win_rate)}</td>
                <td data-label="Total" className={`num ${tone(s.total_pnl)}`}>{money(s.total_pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Cumulative P/L">
        <div className="panel-body"><PnlChart points={stats.curve} /></div>
      </Panel>

      <Panel title="By setup" extra={
        <span className="count">
          BEST {stats.best_setup ?? '--'} / WORST {stats.worst_setup ?? '--'}
        </span>
      }>
        <table className="grid">
          <thead><tr><th>Setup</th><th className="num">n</th><th className="num">Win rate</th><th className="num">Total</th><th className="num">Avg</th></tr></thead>
          <tbody>
            {stats.by_setup.map((/** @type {any} */ s) => (
              <tr key={s.setup}>
                <td data-label="Setup">{s.setup}</td>
                <td data-label="n" className="num">{s.n}</td>
                <td data-label="Win rate" className="num">{percent(s.win_rate)}</td>
                <td data-label="Total" className={`num ${tone(s.total_pnl)}`}>{money(s.total_pnl)}</td>
                <td data-label="Avg" className={`num ${tone(s.avg_pnl)}`}>{money(s.avg_pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="empty">Best and worst need at least 3 closed trades in a setup.</p>
      </Panel>

      <Panel title="Does your checklist pay?">
        {stats.rules.length === 0 ? <p className="empty">Add rules and grade trades to see this.</p> : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Rule</th><th className="num">Followed avg</th><th className="num">Broken avg</th><th className="num">Edge</th></tr></thead>
              <tbody>
                {stats.rules.map((/** @type {any} */ r) => (
                  <tr key={r.rule_id}>
                    <td data-label="Rule" className="wrap">{r.text}</td>
                    <td data-label="Followed avg" className={`num ${tone(r.followed.avg_pnl)}`}>
                      {money(r.followed.avg_pnl)}{' '}
                      <span className="muted">win {percent(r.followed.win_rate)} &middot; n={r.followed.n}</span>
                    </td>
                    <td data-label="Broken avg" className={`num ${tone(r.broken.avg_pnl)}`}>
                      {money(r.broken.avg_pnl)}{' '}
                      <span className="muted">win {percent(r.broken.win_rate)} &middot; n={r.broken.n}</span>
                    </td>
                    <td data-label="Edge" className={`num edge ${tone(r.edge)}`}>
                      <span className="edge-bar" aria-hidden="true"><span style={{ '--mag': `${(Math.abs(r.edge ?? 0) / maxEdge) * 50}%` }} /></span>
                      <b>{money(r.edge)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="tiles">
          <Tile label="Disciplined (80%+) avg" value={stats.discipline.disciplined.avg_pnl} format={money} cls={tone(stats.discipline.disciplined.avg_pnl)} n={stats.discipline.disciplined.n} />
          <Tile label="Disciplined win rate" value={stats.discipline.disciplined.win_rate} format={percent} />
          <Tile label="Rest avg" value={stats.discipline.rest.avg_pnl} format={money} cls={tone(stats.discipline.rest.avg_pnl)} n={stats.discipline.rest.n} />
          <Tile label="Rest win rate" value={stats.discipline.rest.win_rate} format={percent} />
        </div>
      </Panel>

      <Panel title="Journal honesty">
        <p className="panel-body honesty">
          {stats.honesty.edited} of {stats.honesty.closed} closed trades ({percent(stats.honesty.share)}) were edited after closing.
          {stats.honesty.trade_ids.length > 0 && (
            <span className="muted">
              {' '}Trades: {stats.honesty.trade_ids.map((/** @type {number} */ id) => {
                const trade = trades.find((t) => t.id === id)
                return trade ? contractLabel(trade) : `#${id}`
              }).join(', ')}
            </span>
          )}
        </p>
      </Panel>
    </>
  )
}
