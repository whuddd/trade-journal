import pg from 'pg'
import { createApp } from '../server/app.js'
import { basicAuthFromEnv } from '../server/basic-auth.js'
import { createStore } from '../server/db.js'
import { pgDb } from '../server/pg.js'

// The backend on Vercel. vercel.json rewrites every /api/* request here, and Express routes it.
// The schema is migrated during the build (scripts/migrate.js), not here.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 })

export default createApp(createStore(pgDb(pool)), {
  commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
  auth: basicAuthFromEnv(process.env),
})
