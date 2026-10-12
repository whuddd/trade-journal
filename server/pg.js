import pg from 'pg'

/**
 * The store talks to Postgres through this small interface, so the same SQL runs on Neon in
 * production (node-postgres) and on PGlite, an in-process Postgres, locally and in tests.
 *
 * @typedef {{query: (sql: string, params?: unknown[]) => Promise<any[]>}} Queryable
 * @typedef {Queryable & {
 *   transaction: <T>(work: (tx: Queryable) => Promise<T>) => Promise<T>,
 *   close: () => Promise<void>,
 * }} Db
 */

/**
 * @param {import('pg').Pool} pool
 * @returns {Db}
 */
export function pgDb(pool) {
  return {
    async query(sql, params = []) {
      return (await pool.query(sql, params)).rows
    },
    async transaction(work) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work({ query: async (sql, params = []) => (await client.query(sql, params)).rows })
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}

/**
 * A pool on a Postgres URL. Neon's URLs say sslmode=require, which node-postgres treats as
 * verify-full today but warns will weaken in its next major version, so ask for verify-full
 * by name.
 *
 * @param {string} url
 * @param {number} [max] connections; keep it small on serverless functions
 */
export function pgUrlDb(url, max = 3) {
  const parsed = new URL(url)
  if (['prefer', 'require', 'verify-ca'].includes(parsed.searchParams.get('sslmode') ?? '')) {
    parsed.searchParams.set('sslmode', 'verify-full')
  }
  return pgDb(new pg.Pool({ connectionString: parsed.toString(), max }))
}

/**
 * @param {string} [dataDir] a folder to keep the data in; in memory when omitted
 * @returns {Promise<Db>}
 */
export async function pgliteDb(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite(dataDir)
  return {
    async query(sql, params = []) {
      return (await db.query(sql, params)).rows
    },
    transaction(work) {
      return db.transaction((tx) => work({ query: async (sql, params = []) => (await tx.query(sql, params)).rows }))
    },
    async close() {
      await db.close()
    },
  }
}
