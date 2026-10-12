import { useEffect, useState } from 'react'

/** Regular US equity session, 9:30 to 16:00 New York time on weekdays. Ignores holidays. */
function marketOpen(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  return minutes >= 570 && minutes < 960
}

const HINTS = {
  journal: [['N', 'new trade'], ['1', 'journal'], ['2', 'stats'], ['3', 'rules']],
  stats: [['1', 'journal'], ['2', 'stats'], ['3', 'rules']],
  rules: [['1', 'journal'], ['2', 'stats'], ['3', 'rules']],
}

/**
 * Bottom status line, like tmux or vim: where you are, the keyboard
 * shortcuts that work here, and a ticking clock.
 * @param {{tab: string, tradeCount: number}} props
 */
export default function StatusBar({ tab, tradeCount }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const open = marketOpen(now)
  return (
    <footer className="statusbar">
      <span className="status-mode">{tab.toUpperCase()}</span>
      <span className="status-file">neon/postgres <span className="muted">· {tradeCount} trades</span></span>
      <span className="status-keys">
        {HINTS[/** @type {keyof typeof HINTS} */ (tab)].map(([key, what]) => (
          <span key={key}><kbd>{key}</kbd> {what}</span>
        ))}
      </span>
      <span className={`status-mkt ${open ? 'up' : 'muted'}`} title="Regular session, 9:30 to 4:00 ET. Holidays not included.">
        MKT {open ? 'OPEN' : 'CLOSED'}
      </span>
      <span className="status-clock">{now.toLocaleTimeString('en-US', { hour12: false })}</span>
    </footer>
  )
}
