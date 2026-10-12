import { DatabaseSync } from 'node:sqlite'
import { TRADE_FIELDS, checklistScore, diffTrade, tradePnl } from './journal.js'

/** @typedef {ReturnType<typeof createStore>} Store */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY,
    ticker TEXT NOT NULL,
    option_type TEXT NOT NULL CHECK (option_type IN ('call', 'put')),
    strike REAL NOT NULL,
    expiration TEXT NOT NULL,
    contracts INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    entry_premium REAL NOT NULL,
    exit_date TEXT,
    exit_premium REAL,
    setup TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trade_rules (
    trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    followed INTEGER NOT NULL,
    PRIMARY KEY (trade_id, rule_id)
  );
  CREATE TABLE IF NOT EXISTS trade_edits (
    id INTEGER PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    old_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    edited_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_days (
    day TEXT PRIMARY KEY
  );
`

/** @param {any} row */
function toRule(row) {
  return { id: Number(row.id), text: String(row.text), created_at: String(row.created_at) }
}

/** @param {any} row */
function toTicks(row) {
  return { rule_id: Number(row.rule_id), followed: Number(row.followed) === 1 }
}

/**
 * @param {any} row
 * @param {{rule_id: number, followed: boolean}[]} checklist
 * @param {number} editCount
 */
function toTrade(row, checklist, editCount) {
  const trade = {
    id: Number(row.id),
    ticker: String(row.ticker),
    option_type: String(row.option_type),
    strike: Number(row.strike),
    expiration: String(row.expiration),
    contracts: Number(row.contracts),
    entry_date: String(row.entry_date),
    entry_premium: Number(row.entry_premium),
    exit_date: row.exit_date === null ? null : String(row.exit_date),
    exit_premium: row.exit_premium === null ? null : Number(row.exit_premium),
    setup: String(row.setup),
    notes: String(row.notes),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
  return {
    ...trade,
    status: trade.exit_date === null ? 'open' : 'closed',
    checklist,
    score: checklistScore(checklist),
    pnl: tradePnl(trade),
    edits_after_close: editCount,
  }
}

/**
 * @param {string} filename
 * @param {() => string} [now]
 */
export function createStore(filename, now = () => new Date().toISOString()) {
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  /**
   * @template T
   * @param {() => T} work
   */
  function transaction(work) {
    db.exec('BEGIN')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function listRules() {
    return db.prepare('SELECT id, text, created_at FROM rules ORDER BY id').all().map(toRule)
  }

  /** @param {number} id */
  function getRule(id) {
    const row = db.prepare('SELECT id, text, created_at FROM rules WHERE id = ?').get(id)
    return row ? toRule(row) : undefined
  }

  /**
   * @param {string} text
   * @param {number | null} [exceptId]
   */
  function ruleTextTaken(text, exceptId = null) {
    return Boolean(db.prepare('SELECT 1 FROM rules WHERE text = ? COLLATE NOCASE AND id IS NOT ?').get(text, exceptId))
  }

  /** @param {string} text */
  function createRule(text) {
    const { lastInsertRowid } = db.prepare('INSERT INTO rules (text, created_at) VALUES (?, ?)').run(text, now())
    return /** @type {ReturnType<typeof toRule>} */ (getRule(Number(lastInsertRowid)))
  }

  /**
   * @param {number} id
   * @param {string} text
   */
  function updateRule(id, text) {
    const { changes } = db.prepare('UPDATE rules SET text = ? WHERE id = ?').run(text, id)
    return Number(changes) > 0 ? getRule(id) : undefined
  }

  /** @param {number} id */
  function deleteRule(id) {
    return Number(db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes) > 0
  }

  function listTrades() {
    /** @type {Map<number, {rule_id: number, followed: boolean}[]>} */
    const ticks = new Map()
    for (const row of db.prepare('SELECT trade_id, rule_id, followed FROM trade_rules ORDER BY rule_id').all()) {
      const id = Number(row.trade_id)
      ticks.set(id, [...(ticks.get(id) ?? []), toTicks(row)])
    }
    /** @type {Map<number, number>} */
    const edits = new Map()
    for (const row of db.prepare('SELECT trade_id, COUNT(*) AS n FROM trade_edits GROUP BY trade_id').all()) {
      edits.set(Number(row.trade_id), Number(row.n))
    }
    return db.prepare('SELECT * FROM trades ORDER BY exit_date IS NOT NULL, entry_date DESC, id DESC').all()
      .map((row) => toTrade(row, ticks.get(Number(row.id)) ?? [], edits.get(Number(row.id)) ?? 0))
  }

  /** @param {number} id */
  function getTrade(id) {
    const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id)
    if (!row) return undefined
    const checklist = db.prepare('SELECT rule_id, followed FROM trade_rules WHERE trade_id = ? ORDER BY rule_id').all(id).map(toTicks)
    const edits = db.prepare('SELECT id, field, old_value, new_value, edited_at FROM trade_edits WHERE trade_id = ? ORDER BY id DESC').all(id)
      .map((e) => ({ id: Number(e.id), field: String(e.field), old_value: String(e.old_value), new_value: String(e.new_value), edited_at: String(e.edited_at) }))
    return { ...toTrade(row, checklist, edits.length), edits }
  }

  /**
   * @param {number} tradeId
   * @param {{rule_id: number, followed: boolean}[]} checklist
   */
  function writeChecklist(tradeId, checklist) {
    const insert = db.prepare('INSERT INTO trade_rules (trade_id, rule_id, followed) VALUES (?, ?, ?)')
    for (const tick of checklist) insert.run(tradeId, tick.rule_id, tick.followed ? 1 : 0)
  }

  /** @param {any} value */
  function createTrade(value) {
    const id = transaction(() => {
      const stamp = now()
      const columns = [...TRADE_FIELDS, 'created_at', 'updated_at']
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO trades (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...TRADE_FIELDS.map((f) => value[f]), stamp, stamp)
      writeChecklist(Number(lastInsertRowid), value.checklist)
      return Number(lastInsertRowid)
    })
    return /** @type {NonNullable<ReturnType<typeof getTrade>>} */ (getTrade(id))
  }

  /**
   * @param {number} id
   * @param {any} value
   */
  function updateTrade(id, value) {
    const before = getTrade(id)
    if (!before) return undefined
    transaction(() => {
      const stamp = now()
      if (before.status === 'closed') {
        const ruleText = new Map(listRules().map((r) => [r.id, r.text]))
        const insert = db.prepare('INSERT INTO trade_edits (trade_id, field, old_value, new_value, edited_at) VALUES (?, ?, ?, ?, ?)')
        for (const change of diffTrade(before, value, ruleText)) {
          insert.run(id, change.field, change.old_value, change.new_value, stamp)
        }
      }
      db.prepare(`UPDATE trades SET ${TRADE_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...TRADE_FIELDS.map((f) => value[f]), stamp, id)
      db.prepare('DELETE FROM trade_rules WHERE trade_id = ?').run(id)
      writeChecklist(id, value.checklist)
    })
    return getTrade(id)
  }

  /** @param {number} id */
  function deleteTrade(id) {
    return Number(db.prepare('DELETE FROM trades WHERE id = ?').run(id).changes) > 0
  }

  /** @param {string} day */
  function recordActivity(day) {
    db.prepare('INSERT OR IGNORE INTO activity_days (day) VALUES (?)').run(day)
  }

  function listActivityDays() {
    return db.prepare('SELECT day FROM activity_days ORDER BY day').all().map((row) => String(row.day))
  }

  function listSetups() {
    return db.prepare('SELECT setup, COUNT(*) AS n FROM trades GROUP BY setup ORDER BY n DESC, setup').all()
      .map((row) => String(row.setup))
  }

  function close() {
    db.close()
  }

  return {
    listRules, getRule, ruleTextTaken, createRule, updateRule, deleteRule,
    listTrades, getTrade, createTrade, updateTrade, deleteTrade,
    recordActivity, listActivityDays, listSetups, close,
  }
}
