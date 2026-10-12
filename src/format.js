import { TRADE_FIELDS } from '../server/journal.js'

export { TRADE_FIELDS }

/** @param {number | null | undefined} value */
export function money(value) {
  if (value === null || value === undefined) return '--'
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (value > 0) return `+$${abs}`
  if (value < 0) return `-$${abs}`
  return `$${abs}`
}

/** @param {number | null | undefined} value */
export function premium(value) {
  return value === null || value === undefined ? '--' : value.toFixed(2)
}

/** @param {number | null | undefined} ratio */
export function percent(ratio) {
  return ratio === null || ratio === undefined ? '--' : `${(ratio * 100).toFixed(1)}%`
}

/** @param {number | null | undefined} value */
export function tone(value) {
  if (!value) return 'flat'
  return value > 0 ? 'up' : 'down'
}

/** @param {{followed: number, graded: number} | null} score */
export function scoreText(score) {
  return score ? `${score.followed}/${score.graded}` : 'not graded'
}

export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * @param {string} from
 * @param {string} to
 */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

/** @param {string} day */
export function shortDate(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** @param {{ticker: string, strike: number, option_type: string, expiration: string}} trade */
export function contractLabel(trade) {
  return `${trade.ticker} ${trade.strike}${trade.option_type === 'call' ? 'C' : 'P'} ${shortDate(trade.expiration)}`
}

/** @param {Record<string, any>} trade */
export function draftOf(trade) {
  return { ...Object.fromEntries(TRADE_FIELDS.map((f) => [f, trade[f]])), checklist: trade.checklist }
}
