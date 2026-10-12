import { useEffect, useState } from 'react'
import { prefersStill } from './motion.jsx'

const LINES = [
  ['TJ/OS v1.0', 'trade journal terminal'],
  ['mount', 'neon/postgres'],
  ['load', 'checklist rules'],
  ['index', 'open + closed trades'],
  ['sync', 'journaling streak'],
]
const STEP_MS = 140
const HOLD_MS = 260
const FADE_MS = 380
const SEEN_KEY = 'tj-booted'

function seenThisSession() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A one-second boot screen shown once per browser session. Any click or key
 * skips it, and it never shows under reduced motion.
 */
export default function Boot() {
  const [phase, setPhase] = useState(() => (prefersStill() || seenThisSession() ? 'done' : 'run'))

  useEffect(() => {
    if (phase === 'done') return
    try {
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Private windows can refuse storage; the boot screen just shows again.
    }
    if (phase === 'fade') {
      const timer = setTimeout(() => setPhase('done'), FADE_MS)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setPhase('fade'), LINES.length * STEP_MS + HOLD_MS)
    const skip = () => setPhase('fade')
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [phase])

  if (phase === 'done') return null
  return (
    <div className={`boot ${phase === 'fade' ? 'boot-out' : ''}`} aria-hidden="true">
      <div className="boot-box">
        {LINES.map(([verb, what], i) => (
          <div key={verb} className="boot-line" style={{ animationDelay: `${i * STEP_MS}ms` }}>
            {i === 0 ? (
              <><b>{verb}</b> <span className="muted">{what}</span></>
            ) : (
              <><span className="slash">&gt;</span> {verb} <span className="muted">{what}</span><span className="boot-ok">ok</span></>
            )}
          </div>
        ))}
        <div className="boot-bar">
          <span style={{ animationDuration: `${LINES.length * STEP_MS + HOLD_MS}ms` }} />
        </div>
      </div>
    </div>
  )
}
