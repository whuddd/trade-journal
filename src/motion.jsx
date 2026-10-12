import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * True when the page should skip decorative motion: the user asked for reduced
 * motion, or the environment has no matchMedia (jsdom in tests), where
 * animated values would only get in the way of assertions.
 */
export function prefersStill() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Counts a number from its previous value (zero on first render) to `value`
 * and renders it through `format`.
 * Screen readers and still environments get the final value only.
 * @param {{value: number | null | undefined, format: (v: number | null | undefined) => string, duration?: number}} props
 */
export function CountUp({ value, format, duration = 700 }) {
  const [shown, setShown] = useState(/** @type {number | null} */ (null))
  const last = useRef(0)
  const still = prefersStill() || value === null || value === undefined

  useEffect(() => {
    if (still) return
    let frame = 0
    const start = performance.now()
    const from = last.current
    const target = /** @type {number} */ (value)
    const tick = (/** @type {number} */ now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      last.current = t === 1 ? target : from + (target - from) * eased
      setShown(last.current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration, still])

  if (still) return <>{format(value)}</>
  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">{format(shown ?? 0)}</span>
    </>
  )
}

/** @typedef {{id: number, text: string, tone: 'up' | 'down' | 'info'}} Toast */

const ToastContext = createContext(/** @type {(text: string, tone?: Toast['tone']) => void} */ (() => {}))

/** Show a short confirmation toast. A no-op outside ToastProvider (tests). */
export function useToast() {
  return useContext(ToastContext)
}

const TOAST_MS = 2600

/** @param {{children: import('react').ReactNode}} props */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState(/** @type {Toast[]} */ ([]))
  const nextId = useRef(1)

  const push = useCallback((/** @type {string} */ text, /** @type {Toast['tone']} */ tone = 'info') => {
    const id = nextId.current++
    setToasts((list) => [...list.slice(-2), { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), TOAST_MS)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span className="toast-mark" aria-hidden="true">{t.tone === 'down' ? '×' : '✓'}</span>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * True when a keyboard shortcut should be ignored because the user is typing
 * or holding a modifier.
 * @param {KeyboardEvent} event
 */
export function isTyping(event) {
  const el = /** @type {HTMLElement | null} */ (event.target)
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  if (!el || !el.tagName) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
