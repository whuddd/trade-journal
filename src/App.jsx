import { useCallback, useEffect, useState } from 'react'
import { api, SIGNED_OUT } from './api.js'
import Boot from './Boot.jsx'
import Journal from './Journal.jsx'
import { CountUp, isTyping, ToastProvider } from './motion.jsx'
import Rules from './Rules.jsx'
import SignIn from './SignIn.jsx'
import Stats from './Stats.jsx'
import StatusBar from './StatusBar.jsx'
import Tape from './Tape.jsx'

const TABS = [['journal', 'Journal'], ['stats', 'Stats'], ['rules', 'Rules']]

/** @param {number | null | undefined} n */
const days = (n) => (n === null || n === undefined ? '--' : `${Math.round(n)}D`)

/** @typedef {{id: number, login: string, name: string | null, avatar_url: string | null, role: 'owner' | 'member'}} User */

/** Reads and removes ?signin=failed, which the server adds when a GitHub sign-in falls through. */
function takeSignInFailure() {
  const url = new URL(window.location.href)
  if (url.searchParams.get('signin') !== 'failed') return false
  url.searchParams.delete('signin')
  window.history.replaceState(null, '', url)
  return true
}

/** @param {{user: User, onSignOut: () => void}} props */
function UserChip({ user, onSignOut }) {
  return (
    <div className="user-chip">
      {user.avatar_url && <img className="avatar" src={user.avatar_url} alt="" width="20" height="20" />}
      <span className="user-login">{user.login}</span>
      <span className={`role role-${user.role}`}>{user.role}</span>
      <button type="button" className="btn" onClick={onSignOut}>Sign out</button>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(/** @type {User | null | undefined} */ (undefined))
  const [signInFailed] = useState(takeSignInFailure)

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null))
    const signedOut = () => setUser(null)
    window.addEventListener(SIGNED_OUT, signedOut)
    return () => window.removeEventListener(SIGNED_OUT, signedOut)
  }, [])

  async function signOut() {
    await api.signOut().catch(() => {})
    setUser(null)
  }

  if (user === undefined) return <div className="crt" aria-hidden="true" />
  if (user === null) {
    return (
      <>
        <div className="crt" aria-hidden="true" />
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <span className="brand-mark">TJ</span>
              <span className="brand-name">TRADE<span className="slash">//</span>JOURNAL</span>
            </div>
          </header>
          <SignIn failed={signInFailed} />
        </div>
      </>
    )
  }
  return <Journaling user={user} onSignOut={signOut} />
}

/** @param {{user: User, onSignOut: () => void}} props */
function Journaling({ user, onSignOut }) {
  const [tab, setTab] = useState('journal')
  const [activity, setActivity] = useState(/** @type {{current_streak: number, longest_streak: number} | null} */ (null))
  const [trades, setTrades] = useState(/** @type {any[]} */ ([]))

  const loadActivity = useCallback(() => {
    api.activity().then(setActivity).catch(() => setActivity(null))
    api.listTrades().then(setTrades).catch(() => setTrades([]))
  }, [])

  useEffect(() => {
    loadActivity()
  }, [loadActivity])

  useEffect(() => {
    /** @param {KeyboardEvent} event */
    function onKey(event) {
      if (isTyping(event)) return
      const index = ['1', '2', '3'].indexOf(event.key)
      if (index >= 0) setTab(TABS[index][0])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tabIndex = TABS.findIndex(([key]) => key === tab)

  return (
    <ToastProvider>
      <Boot />
      <div className="crt" aria-hidden="true" />
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">TJ</span>
            <span className="brand-name">TRADE<span className="slash">//</span>JOURNAL</span>
          </div>
          <nav className="tabs" aria-label="Sections" style={{ '--tab': tabIndex }}>
            {TABS.map(([key, label], i) => (
              <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} title={`${label} (${i + 1})`}>
                {label}
              </button>
            ))}
            <span className="tab-ink" aria-hidden="true" />
          </nav>
          <div className="streak" aria-label="Journaling streak">
            <span className="live-dot" aria-hidden="true" />
            <span>STREAK <b><CountUp value={activity?.current_streak} format={days} /></b></span>
            <span className="muted">BEST {days(activity?.longest_streak)}</span>
          </div>
          <UserChip user={user} onSignOut={onSignOut} />
        </header>
        <Tape trades={trades} />
        <main className="content" key={tab}>
          {tab === 'journal' && <Journal onChanged={loadActivity} />}
          {tab === 'stats' && <Stats />}
          {tab === 'rules' && <Rules canEdit={user.role === 'owner'} />}
        </main>
      </div>
      <StatusBar tab={tab} tradeCount={trades.length} />
    </ToastProvider>
  )
}
