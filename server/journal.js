const TICKER = /^[A-Z](?:[A-Z.]{0,8}[A-Z])?$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Trade columns the user controls, in table order. */
export const TRADE_FIELDS = [
  'ticker', 'option_type', 'strike', 'expiration', 'contracts', 'entry_date',
  'entry_premium', 'exit_date', 'exit_premium', 'setup', 'notes',
]

/** @param {string} error */
function fail(error) {
  return { ok: false, error }
}

/** @param {number} n */
export function round2(n) {
  return Math.round(n * 100) / 100
}

/** @param {unknown} value */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** @param {unknown} value */
function blank(value) {
  return value === undefined || value === null || value === ''
}

/** @param {unknown} value */
export function isDay(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** @param {unknown} value */
function readChecklist(value) {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return fail('Checklist must be a list.')
  const seen = new Set()
  const out = []
  for (const item of value) {
    const ruleId = item?.rule_id
    if (!Number.isInteger(ruleId) || ruleId < 1) return fail('Each checklist entry needs a rule_id.')
    if (typeof item.followed !== 'boolean') return fail('Each checklist entry needs followed: true or false.')
    if (seen.has(ruleId)) return fail('A rule can only be graded once per trade.')
    seen.add(ruleId)
    out.push({ rule_id: ruleId, followed: item.followed })
  }
  out.sort((a, b) => a.rule_id - b.rule_id)
  return { ok: true, value: out }
}

/** @param {any} input */
export function validateTrade(input) {
  const b = input && typeof input === 'object' ? input : {}

  const ticker = typeof b.ticker === 'string' ? b.ticker.trim().toUpperCase() : ''
  if (!TICKER.test(ticker)) return fail('Ticker must be 1 to 10 letters, like SPY or BRK.B.')
  if (b.option_type !== 'call' && b.option_type !== 'put') return fail('Option type must be call or put.')

  const strike = toNumber(b.strike)
  if (strike === null || strike <= 0) return fail('Strike must be a positive number.')
  if (!isDay(b.expiration)) return fail('Expiration must be a date (YYYY-MM-DD).')

  const contracts = toNumber(b.contracts)
  if (contracts === null || !Number.isInteger(contracts) || contracts < 1) {
    return fail('Contracts must be a whole number of at least 1.')
  }

  if (!isDay(b.entry_date)) return fail('Entry date must be a date (YYYY-MM-DD).')
  const entryPremium = toNumber(b.entry_premium)
  if (entryPremium === null || entryPremium < 0) return fail('Entry premium must be 0 or more.')

  const hasExitDate = !blank(b.exit_date)
  if (hasExitDate !== !blank(b.exit_premium)) return fail('Exit date and exit premium go together.')
  let exitDate = null
  let exitPremium = null
  if (hasExitDate) {
    if (!isDay(b.exit_date)) return fail('Exit date must be a date (YYYY-MM-DD).')
    if (b.exit_date < b.entry_date) return fail("Exit date can't be before entry date.")
    exitPremium = toNumber(b.exit_premium)
    if (exitPremium === null || exitPremium < 0) return fail('Exit premium must be 0 or more.')
    exitDate = b.exit_date
  }

  const setup = typeof b.setup === 'string' ? b.setup.trim() : ''
  if (!setup) return fail('Setup is required.')
  if (setup.length > 60) return fail('Setup must be 60 characters or fewer.')

  const notes = typeof b.notes === 'string' ? b.notes : ''
  if (notes.length > 2000) return fail('Notes must be 2,000 characters or fewer.')

  const checklist = readChecklist(b.checklist)
  if (!checklist.ok) return checklist

  return {
    ok: true,
    value: {
      ticker,
      option_type: b.option_type,
      strike,
      expiration: b.expiration,
      contracts,
      entry_date: b.entry_date,
      entry_premium: entryPremium,
      exit_date: exitDate,
      exit_premium: exitPremium,
      setup,
      notes,
      checklist: checklist.value,
    },
  }
}

/** @param {any} input */
export function validateRule(input) {
  const text = typeof input?.text === 'string' ? input.text.trim() : ''
  if (!text) return fail('Rule text is required.')
  if (text.length > 120) return fail('Rule text must be 120 characters or fewer.')
  return { ok: true, value: { text } }
}

/** @param {{entry_premium: number, exit_premium: number | null, contracts: number}} trade */
export function tradePnl(trade) {
  if (trade.exit_premium === null || trade.exit_premium === undefined) return null
  return round2((trade.exit_premium - trade.entry_premium) * trade.contracts * 100)
}

/** @param {{rule_id: number, followed: boolean}[]} checklist */
export function checklistScore(checklist) {
  if (checklist.length === 0) return null
  const followed = checklist.filter((c) => c.followed).length
  return { followed, graded: checklist.length, ratio: followed / checklist.length }
}

/** @param {unknown} value */
function shown(value) {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * @param {{rule_id: number, followed: boolean}[]} checklist
 * @param {number} ruleId
 */
function tickOf(checklist, ruleId) {
  const tick = checklist.find((c) => c.rule_id === ruleId)
  if (!tick) return 'not graded'
  return tick.followed ? 'followed' : 'broken'
}

/**
 * Differences between a stored trade and its replacement, one entry per changed field or tick.
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @param {Map<number, string>} ruleText
 */
export function diffTrade(before, after, ruleText) {
  const changes = []
  for (const field of TRADE_FIELDS) {
    const oldValue = shown(before[field])
    const newValue = shown(after[field])
    if (oldValue !== newValue) changes.push({ field, old_value: oldValue, new_value: newValue })
  }
  const ruleIds = [...new Set([...before.checklist, ...after.checklist].map((c) => c.rule_id))].sort((a, b) => a - b)
  for (const ruleId of ruleIds) {
    const oldValue = tickOf(before.checklist, ruleId)
    const newValue = tickOf(after.checklist, ruleId)
    if (oldValue !== newValue) {
      changes.push({ field: `checklist: ${ruleText.get(ruleId) ?? `rule ${ruleId}`}`, old_value: oldValue, new_value: newValue })
    }
  }
  return changes
}

/** Calendar date on this computer, as YYYY-MM-DD. */
export function localDay(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * @param {string} day
 * @param {number} n
 */
export function addDays(day, n) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

/**
 * @param {string[]} days
 * @param {string} today
 */
export function streaks(days, today) {
  const set = new Set(days)
  let cursor = set.has(today) ? today : addDays(today, -1)
  let current = 0
  while (set.has(cursor)) {
    current += 1
    cursor = addDays(cursor, -1)
  }

  let longest = 0
  let run = 0
  /** @type {string | null} */
  let previous = null
  for (const day of [...set].sort()) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = day
  }
  return { current_streak: current, longest_streak: longest }
}

/** @param {number[]} values */
function mean(values) {
  return values.length === 0 ? null : round2(values.reduce((a, b) => a + b, 0) / values.length)
}

/** @param {{pnl: number}[]} trades */
function summarize(trades) {
  const n = trades.length
  const pnls = trades.map((t) => t.pnl)
  return {
    n,
    win_rate: n === 0 ? null : pnls.filter((p) => p > 0).length / n,
    total_pnl: round2(pnls.reduce((a, b) => a + b, 0)),
    avg_pnl: mean(pnls),
  }
}

/**
 * @param {any[]} trades
 * @param {{id: number, text: string}[]} rules
 */
export function computeStats(trades, rules) {
  const closed = trades.filter((t) => t.pnl !== null && t.pnl !== undefined)
  const all = summarize(closed)

  const overview = {
    n: all.n,
    win_rate: all.win_rate,
    total_pnl: all.total_pnl,
    avg_win: mean(closed.filter((t) => t.pnl > 0).map((t) => t.pnl)),
    avg_loss: mean(closed.filter((t) => t.pnl < 0).map((t) => t.pnl)),
    expectancy: all.avg_pnl,
  }

  const by_type = {
    call: summarize(closed.filter((t) => t.option_type === 'call')),
    put: summarize(closed.filter((t) => t.option_type === 'put')),
  }

  let running = 0
  const curve = [...closed]
    .sort((a, b) => (a.exit_date === b.exit_date ? a.id - b.id : a.exit_date < b.exit_date ? -1 : 1))
    .map((t) => {
      running = round2(running + t.pnl)
      return { id: t.id, exit_date: t.exit_date, pnl: t.pnl, cumulative: running }
    })

  /** @type {Map<string, any[]>} */
  const groups = new Map()
  for (const t of closed) groups.set(t.setup, [...(groups.get(t.setup) ?? []), t])
  const by_setup = [...groups].map(([setup, list]) => ({ setup, ...summarize(list) }))
    .sort((a, b) => b.total_pnl - a.total_pnl || a.setup.localeCompare(b.setup))
  const qualifying = by_setup.filter((s) => s.n >= 3).sort((a, b) => b.avg_pnl - a.avg_pnl)
  const best_setup = qualifying[0]?.setup ?? null
  const worst_setup = qualifying.length > 1 ? qualifying[qualifying.length - 1].setup : null

  const ruleStats = rules.map((rule) => {
    /** @param {boolean} followed */
    const side = (followed) => summarize(closed.filter((t) => t.checklist.some((c) => c.rule_id === rule.id && c.followed === followed)))
    const followed = side(true)
    const broken = side(false)
    const edge = followed.n > 0 && broken.n > 0 ? round2(followed.avg_pnl - broken.avg_pnl) : null
    return { rule_id: rule.id, text: rule.text, followed, broken, edge }
  })

  const graded = closed.filter((t) => t.score)
  const discipline = {
    disciplined: summarize(graded.filter((t) => t.score.ratio >= 0.8)),
    rest: summarize(graded.filter((t) => t.score.ratio < 0.8)),
  }

  const edited = closed.filter((t) => t.edits_after_close > 0)
  const honesty = {
    edited: edited.length,
    closed: closed.length,
    share: closed.length === 0 ? null : edited.length / closed.length,
    trade_ids: edited.map((t) => t.id),
  }

  return { overview, by_type, curve, by_setup, best_setup, worst_setup, rules: ruleStats, discipline, honesty }
}
