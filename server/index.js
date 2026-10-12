import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { createStore } from './db.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const dbPath = resolve(root, process.env.DB_PATH ?? 'data/journal.db')
mkdirSync(dirname(dbPath), { recursive: true })

const store = createStore(dbPath)
const dist = resolve(root, 'dist')
const app = createApp(store, { staticDir: existsSync(dist) ? dist : undefined })

const server = app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  console.log(`Trade Journal on http://127.0.0.1:${port}`)
})

function shutdown() {
  server.close(() => {
    store.close()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
