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
