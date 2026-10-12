import express from 'express'
import { join } from 'node:path'
import { computeStats, localDay, streaks, validateRule, validateTrade } from './journal.js'

const NO_TRADE = 'That trade no longer exists.'
const NO_RULE = 'That rule no longer exists.'
const DUPLICATE_RULE = 'That rule already exists.'
const MAX_ID = 2 ** 31 - 1

/** @param {import('express').Request} req */
function idOf(req) {
  const id = Number(req.params.id)
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null
}

/**
 * @param {import('./db.js').Store} store
 * @param {{
 *   today?: () => string,
 *   staticDir?: string,
 *   commit?: string,
 *   auth?: import('express').RequestHandler,
 * }} [options] `auth` guards every API route except /api/version
 */
export function createApp(store, { today = () => localDay(), staticDir, commit = 'dev', auth } = {}) {
  const app = express()
  app.use(express.json())

  app.get('/api/version', (_req, res) => {
    res.json({ commit })
  })

  if (auth) app.use('/api', auth)

  /** @param {{rule_id: number}[]} checklist */
  async function missingRule(checklist) {
    for (const tick of checklist) {
      if (!(await store.getRule(tick.rule_id))) return `Rule ${tick.rule_id} no longer exists.`
    }
    return null
  }

  app.get('/api/trades', async (_req, res) => {
    res.json(await store.listTrades())
  })

  app.get('/api/trades/:id', async (req, res) => {
    const id = idOf(req)
    const trade = id === null ? undefined : await store.getTrade(id)
    if (!trade) {
      res.status(404).json({ error: NO_TRADE })
      return
    }
    res.json(trade)
  })

  app.post('/api/trades', async (req, res) => {
    const result = validateTrade(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    const missing = await missingRule(result.value.checklist)
    if (missing) {
      res.status(404).json({ error: missing })
      return
    }
    const trade = await store.createTrade(result.value)
    await store.recordActivity(today())
    res.status(201).json(trade)
  })

  app.put('/api/trades/:id', async (req, res) => {
    const id = idOf(req)
    if (id === null || !await store.getTrade(id)) {
      res.status(404).json({ error: NO_TRADE })
      return
    }
    const result = validateTrade(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    const missing = await missingRule(result.value.checklist)
    if (missing) {
      res.status(404).json({ error: missing })
      return
    }
    const trade = await store.updateTrade(id, result.value)
    await store.recordActivity(today())
    res.json(trade)
  })

  app.delete('/api/trades/:id', async (req, res) => {
    const id = idOf(req)
    if (id === null || !await store.deleteTrade(id)) {
      res.status(404).json({ error: NO_TRADE })
      return
    }
    await store.recordActivity(today())
    res.status(204).end()
  })

  app.get('/api/rules', async (_req, res) => {
    res.json(await store.listRules())
  })

  app.post('/api/rules', async (req, res) => {
    const result = validateRule(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    if (await store.ruleTextTaken(result.value.text)) {
      res.status(409).json({ error: DUPLICATE_RULE })
      return
    }
    res.status(201).json(await store.createRule(result.value.text))
  })

  app.put('/api/rules/:id', async (req, res) => {
    const id = idOf(req)
    if (id === null || !await store.getRule(id)) {
      res.status(404).json({ error: NO_RULE })
      return
    }
    const result = validateRule(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    if (await store.ruleTextTaken(result.value.text, id)) {
      res.status(409).json({ error: DUPLICATE_RULE })
      return
    }
    res.json(await store.updateRule(id, result.value.text))
  })

  app.delete('/api/rules/:id', async (req, res) => {
    const id = idOf(req)
    if (id === null || !await store.deleteRule(id)) {
      res.status(404).json({ error: NO_RULE })
      return
    }
    res.status(204).end()
  })

  app.get('/api/stats', async (_req, res) => {
    res.json(computeStats(await store.listTrades(), await store.listRules()))
  })

  app.get('/api/setups', async (_req, res) => {
    res.json(await store.listSetups())
  })

  app.get('/api/activity', async (_req, res) => {
    const days = await store.listActivityDays()
    res.json({ ...streaks(days, today()), days })
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'No such API route.' })
  })

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(join(staticDir, 'index.html'))
    })
  }

  /** @type {import('express').ErrorRequestHandler} */
  const onError = (error, _req, res, _next) => {
    const badJson = error?.type === 'entity.parse.failed'
    if (!badJson) console.error(error)
    res.status(badJson ? 400 : 500).json({ error: badJson ? 'Request body must be valid JSON.' : 'Something went wrong on the server.' })
  }
  app.use(onError)

  return app
}
