import { TRADE_FIELDS, checklistScore, diffTrade, tradePnl } from './journal.js'

/** @typedef {ReturnType<typeof createStore>} Store */
/** @typedef {import('./pg.js').Queryable} Queryable */

/** @param {any} row */
function toRule(row) {
  return { id: Number(row.id), text: String(row.text), created_at: String(row.created_at) }
}

/** @param {any} row */
function toTicks(row) {
  return { rule_id: Number(row.rule_id), followed: row.followed === true }
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
 * @param {import('./pg.js').Db} db a migrated database
 * @param {() => string} [now]
 */
export function createStore(db, now = () => new Date().toISOString()) {
  async function listRules() {
    return (await db.query('SELECT id, text, created_at FROM rules ORDER BY id')).map(toRule)
  }

  /**
   * @param {number} id
   * @param {Queryable} [q]
   */
  async function getRule(id, q = db) {
    const [row] = await q.query('SELECT id, text, created_at FROM rules WHERE id = $1', [id])
    return row ? toRule(row) : undefined
  }

  /**
   * @param {string} text
   * @param {number | null} [exceptId]
   */
  async function ruleTextTaken(text, exceptId = null) {
    const rows = await db.query('SELECT 1 FROM rules WHERE lower(text) = lower($1) AND id IS DISTINCT FROM $2::integer', [text, exceptId])
    return rows.length > 0
  }

  /** @param {string} text */
  async function createRule(text) {
    const [row] = await db.query('INSERT INTO rules (text, created_at) VALUES ($1, $2) RETURNING id, text, created_at', [text, now()])
    return toRule(row)
  }

  /**
   * @param {number} id
   * @param {string} text
   */
  async function updateRule(id, text) {
    const [row] = await db.query('UPDATE rules SET text = $1 WHERE id = $2 RETURNING id, text, created_at', [text, id])
    return row ? toRule(row) : undefined
  }

  /** @param {number} id */
  async function deleteRule(id) {
    return (await db.query('DELETE FROM rules WHERE id = $1 RETURNING id', [id])).length > 0
  }

  async function listTrades() {
    /** @type {Map<number, {rule_id: number, followed: boolean}[]>} */
    const ticks = new Map()
    for (const row of await db.query('SELECT trade_id, rule_id, followed FROM trade_rules ORDER BY rule_id')) {
      const id = Number(row.trade_id)
      ticks.set(id, [...(ticks.get(id) ?? []), toTicks(row)])
    }
    /** @type {Map<number, number>} */
    const edits = new Map()
    for (const row of await db.query('SELECT trade_id, COUNT(*) AS n FROM trade_edits GROUP BY trade_id')) {
      edits.set(Number(row.trade_id), Number(row.n))
    }
    return (await db.query('SELECT * FROM trades ORDER BY exit_date IS NOT NULL, entry_date DESC, id DESC'))
      .map((row) => toTrade(row, ticks.get(Number(row.id)) ?? [], edits.get(Number(row.id)) ?? 0))
  }

  /**
   * @param {number} id
   * @param {Queryable} [q]
   */
  async function getTrade(id, q = db) {
    const [row] = await q.query('SELECT * FROM trades WHERE id = $1', [id])
    if (!row) return undefined
    const checklist = (await q.query('SELECT rule_id, followed FROM trade_rules WHERE trade_id = $1 ORDER BY rule_id', [id])).map(toTicks)
    const edits = (await q.query('SELECT id, field, old_value, new_value, edited_at FROM trade_edits WHERE trade_id = $1 ORDER BY id DESC', [id]))
      .map((e) => ({ id: Number(e.id), field: String(e.field), old_value: String(e.old_value), new_value: String(e.new_value), edited_at: String(e.edited_at) }))
    return { ...toTrade(row, checklist, edits.length), edits }
  }

  /**
   * @param {Queryable} q
   * @param {number} tradeId
   * @param {{rule_id: number, followed: boolean}[]} checklist
   */
  async function writeChecklist(q, tradeId, checklist) {
    for (const tick of checklist) {
      await q.query('INSERT INTO trade_rules (trade_id, rule_id, followed) VALUES ($1, $2, $3)', [tradeId, tick.rule_id, tick.followed])
    }
  }

  /** @param {any} value */
  async function createTrade(value) {
    return db.transaction(async (tx) => {
      const stamp = now()
      const columns = [...TRADE_FIELDS, 'created_at', 'updated_at']
      const [{ id }] = await tx.query(
        `INSERT INTO trades (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        [...TRADE_FIELDS.map((f) => value[f]), stamp, stamp],
      )
      await writeChecklist(tx, Number(id), value.checklist)
      return /** @type {NonNullable<Awaited<ReturnType<typeof getTrade>>>} */ (await getTrade(Number(id), tx))
    })
  }

  /**
   * @param {number} id
   * @param {any} value
   */
  async function updateTrade(id, value) {
    return db.transaction(async (tx) => {
      const before = await getTrade(id, tx)
      if (!before) return undefined
      const stamp = now()
      if (before.status === 'closed') {
        const ruleText = new Map((await tx.query('SELECT id, text FROM rules')).map((r) => [Number(r.id), String(r.text)]))
        for (const change of diffTrade(before, value, ruleText)) {
          await tx.query(
            'INSERT INTO trade_edits (trade_id, field, old_value, new_value, edited_at) VALUES ($1, $2, $3, $4, $5)',
            [id, change.field, change.old_value, change.new_value, stamp],
          )
        }
      }
      const n = TRADE_FIELDS.length
      await tx.query(
        `UPDATE trades SET ${TRADE_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')}, updated_at = $${n + 1} WHERE id = $${n + 2}`,
        [...TRADE_FIELDS.map((f) => value[f]), stamp, id],
      )
      await tx.query('DELETE FROM trade_rules WHERE trade_id = $1', [id])
      await writeChecklist(tx, id, value.checklist)
      return getTrade(id, tx)
    })
  }

  /** @param {number} id */
  async function deleteTrade(id) {
    return (await db.query('DELETE FROM trades WHERE id = $1 RETURNING id', [id])).length > 0
  }

  /** @param {string} day */
  async function recordActivity(day) {
    await db.query('INSERT INTO activity_days (day) VALUES ($1) ON CONFLICT DO NOTHING', [day])
  }

  async function listActivityDays() {
    return (await db.query('SELECT day FROM activity_days ORDER BY day')).map((row) => String(row.day))
  }

  async function listSetups() {
    return (await db.query('SELECT setup, COUNT(*) AS n FROM trades GROUP BY setup ORDER BY n DESC, setup'))
      .map((row) => String(row.setup))
  }

  return {
    listRules, getRule, ruleTextTaken, createRule, updateRule, deleteRule,
    listTrades, getTrade, createTrade, updateTrade, deleteTrade,
    recordActivity, listActivityDays, listSetups,
    close: () => db.close(),
  }
}
