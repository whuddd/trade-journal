import { migrate } from '../server/migrations.js'
import { pgUrlDb } from '../server/pg.js'

// Runs during the Vercel build, after the tests and before the new deployment goes live.
// A failure here fails the build, so the previous deployment keeps serving.
const url = process.env.DATABASE_URL
if (!url) {
  if (process.env.VERCEL) {
    console.error('DATABASE_URL is not set for this environment. Add the Neon database in the Vercel project.')
    process.exit(1)
  }
  console.log('DATABASE_URL is not set; nothing to migrate. Local runs migrate PGlite at startup.')
  process.exit(0)
}

const db = pgUrlDb(url, 1)
try {
  const applied = await migrate(db)
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database already up to date.')
} finally {
  await db.close()
}
