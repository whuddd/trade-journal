import { createApp } from '../server/app.js'
import { authFromEnv } from '../server/auth.js'
import { createStore } from '../server/db.js'
import { pgUrlDb } from '../server/pg.js'

// The backend on Vercel. vercel.json rewrites every /api/* request here, and Express routes it.
// The schema is migrated during the build (scripts/migrate.js), not here.
export default createApp(createStore(pgUrlDb(process.env.DATABASE_URL ?? '')), {
  commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
  auth: authFromEnv(process.env),
  trustProxy: true,
})
