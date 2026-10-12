import { contractLabel, money, tone } from './format.js'

const SECONDS_PER_ITEM = 4

/**
 * Scrolling ticker tape of recent closed trades, newest first. Pauses on
 * hover; holds still under reduced motion (CSS).
 * @param {{trades: any[]}} props
 */
export default function Tape({ trades }) {
  const closed = trades
    .filter((t) => t.status === 'closed')
    .sort((a, b) => (a.exit_date < b.exit_date ? 1 : -1))
    .slice(0, 12)
  const open = trades.filter((t) => t.status === 'open')

  if (closed.length === 0 && open.length === 0) {
    return (
      <div className="tape tape-idle" aria-hidden="true">
        <span className="tape-tag">FEED</span>
        <span className="muted">waiting for your first trade<span className="cursor" /></span>
      </div>
    )
  }

  const items = [
    ...open.map((t) => (
      <span className="tape-item" key={`o${t.id}`}>
        <b>{contractLabel(t)}</b> <span className="tape-open">OPEN</span>
      </span>
    )),
    ...closed.map((t) => (
      <span className="tape-item" key={`c${t.id}`}>
        <b>{contractLabel(t)}</b>{' '}
        <span className={tone(t.pnl)}>{t.pnl > 0 ? '▲' : t.pnl < 0 ? '▼' : '■'} {money(t.pnl)}</span>
      </span>
    )),
  ]

  return (
    <div className="tape" aria-label="Recent trades">
      <span className="tape-tag">FEED</span>
      <div className="tape-window">
        <div className="tape-track" style={{ animationDuration: `${Math.max(items.length, 4) * SECONDS_PER_ITEM}s` }}>
          <div className="tape-run">{items}</div>
          <div className="tape-run" aria-hidden="true">{items}</div>
        </div>
      </div>
    </div>
  )
}
