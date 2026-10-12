import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { authFromEnv } from './auth.js'
import { createStore } from './db.js'
import { migrate } from './migrations.js'
import { pgliteDb, pgUrlDb } from './pg.js'

// Runs the app on a laptop. On Vercel, api/index.js is the entry point instead.
// With DATABASE_URL set it uses that Postgres; otherwise PGlite keeps the data in DB_PATH.
// Signing in needs GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and OWNER_GITHUB_ID, which
// `npm start` and `npm run dev` read from .env.local (gitignored) when it exists.
const root = fileURLToPath(new URL('..', import.meta.url))

async function openDb() {
  if (process.env.DATABASE_URL) return pgUrlDb(process.env.DATABASE_URL)
  const dir = resolve(root, process.env.DB_PATH ?? 'data/pgdata')
  mkdirSync(dir, { recursive: true })
  return pgliteDb(dir)
}

const db = await openDb()
await migrate(db)
const store = createStore(db)
const dist = resolve(root, 'dist')
const app = createApp(store, {
  staticDir: existsSync(dist) ? dist : undefined,
  auth: authFromEnv(process.env),
})

const server = app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  console.log(`Trade Journal on http://127.0.0.1:${port}`)
})

function shutdown() {
  server.close(async () => {
    await store.close()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
