/**
 * Schema changes, in order. Each entry runs once, inside one transaction, and is recorded in
 * schema_migrations. Never edit an entry that has shipped: add a new one after it.
 *
 * @type {string[][]}
 */
export const MIGRATIONS = [
  // 1: the PS2 schema, moved from SQLite to Postgres
  [
    `CREATE TABLE trades (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      ticker TEXT NOT NULL,
      option_type TEXT NOT NULL CHECK (option_type IN ('call', 'put')),
      strike DOUBLE PRECISION NOT NULL,
      expiration TEXT NOT NULL,
      contracts INTEGER NOT NULL,
      entry_date TEXT NOT NULL,
      entry_premium DOUBLE PRECISION NOT NULL,
      exit_date TEXT,
      exit_premium DOUBLE PRECISION,
      setup TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE rules (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE UNIQUE INDEX rules_text_unique ON rules (lower(text))',
    `CREATE TABLE trade_rules (
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      followed BOOLEAN NOT NULL,
      PRIMARY KEY (trade_id, rule_id)
    )`,
    `CREATE TABLE trade_edits (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      edited_at TEXT NOT NULL
    )`,
    'CREATE TABLE activity_days (day TEXT PRIMARY KEY)',
  ],
  // 2: GitHub sign-in. Only adds, so every Part A row survives. Rows without a user_id are
  // claimed by the owner the first time they sign in (see claimOrphans in db.js).
  [
    `CREATE TABLE users (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      github_id BIGINT NOT NULL UNIQUE,
      login TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    )`,
    'ALTER TABLE trades ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE',
    'CREATE INDEX trades_user_id ON trades (user_id)',
    'ALTER TABLE activity_days DROP CONSTRAINT activity_days_pkey',
    'ALTER TABLE activity_days ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE',
    'CREATE UNIQUE INDEX activity_days_user_day ON activity_days (user_id, day)',
  ],
]

/** Any constant works, as long as nothing else in the database uses it. */
const LOCK_KEY = 212003

/**
 * Brings the database up to the latest migration. Safe to run any number of times, and from
 * two places at once: the advisory lock makes the second wait for the first.
 *
 * @param {import('./pg.js').Db} db
 * @param {string[][]} [migrations]
 * @returns {Promise<number[]>} the versions applied by this call
 */
export async function migrate(db, migrations = MIGRATIONS) {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY])
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const done = new Set((await tx.query('SELECT version FROM schema_migrations')).map((row) => Number(row.version)))
    const applied = []
    for (const [index, statements] of migrations.entries()) {
      const version = index + 1
      if (done.has(version)) continue
      for (const statement of statements) await tx.query(statement)
      await tx.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [version, new Date().toISOString()])
      applied.push(version)
    }
    return applied
  })
}
