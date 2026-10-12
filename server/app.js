import express from 'express'
import { join } from 'node:path'
import { computeStats, localDay, streaks, validateRule, validateTrade } from './journal.js'

const NO_TRADE = 'That trade no longer exists.'
const NO_RULE = 'That rule no longer exists.'
const DUPLICATE_RULE = 'That rule already exists.'

/** @param {import('express').Request} req */
function idOf(req) {
  const id = Number(req.params.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * @param {import('./db.js').Store} store
 * @param {{today?: () => string, staticDir?: string}} [options]
 */
export function createApp(store, { today = () => localDay(), staticDir } = {}) {
  const app = express()
  app.use(express.json())

  /** @param {{rule_id: number}[]} checklist */
  function missingRule(checklist) {
    const missing = checklist.find((tick) => !store.getRule(tick.rule_id))
    return missing ? `Rule ${missing.rule_id} no longer exists.` : null
  }

  app.get('/api/trades', (_req, res) => {
    res.json(store.listTrades())
  })

  app.get('/api/trades/:id', (req, res) => {
    const id = idOf(req)
    const trade = id === null ? undefined : store.getTrade(id)
    if (!trade) {
      res.status(404).json({ error: NO_TRADE })
      return
    }
    res.json(trade)
  })

  app.post('/api/trades', (req, res) => {
    const result = validateTrade(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    const missing = missingRule(result.value.checklist)
    if (missing) {
      res.status(404).json({ error: missing })
      return
    }
    const trade = store.createTrade(result.value)
    store.recordActivity(today())
    res.status(201).json(trade)
  })

  app.put('/api/trades/:id', (req, res) => {
    const id = idOf(req)
    if (id === null || !store.getTrade(id)) {
      res.status(404).json({ error: NO_TRADE })
      return
    }
    const result = validateTrade(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    const missing = missingRule(result.value.checklist)
    if (missing) {
      res.status(404).json({ error: missing })
      return
    }
    const trade = store.updateTrade(id, result.value)
    store.recordActivity(today())
    res.json(trade)
  })

  app.delete('/api/trades/:id', (req, res) => {
    const id = idOf(req)
    if (id === null || !store.deleteTrade(id)) {
      res.status(404).json({ error: NO_TRADE })
      return
    }
    store.recordActivity(today())
    res.status(204).end()
  })

  app.get('/api/rules', (_req, res) => {
    res.json(store.listRules())
  })

  app.post('/api/rules', (req, res) => {
    const result = validateRule(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    if (store.ruleTextTaken(result.value.text)) {
      res.status(409).json({ error: DUPLICATE_RULE })
      return
    }
    res.status(201).json(store.createRule(result.value.text))
  })

  app.put('/api/rules/:id', (req, res) => {
    const id = idOf(req)
    if (id === null || !store.getRule(id)) {
      res.status(404).json({ error: NO_RULE })
      return
    }
    const result = validateRule(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    if (store.ruleTextTaken(result.value.text, id)) {
      res.status(409).json({ error: DUPLICATE_RULE })
      return
    }
    res.json(store.updateRule(id, result.value.text))
  })

  app.delete('/api/rules/:id', (req, res) => {
    const id = idOf(req)
    if (id === null || !store.deleteRule(id)) {
      res.status(404).json({ error: NO_RULE })
      return
    }
    res.status(204).end()
  })

  app.get('/api/stats', (_req, res) => {
    res.json(computeStats(store.listTrades(), store.listRules()))
  })

  app.get('/api/setups', (_req, res) => {
    res.json(store.listSetups())
  })

  app.get('/api/activity', (_req, res) => {
    const days = store.listActivityDays()
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
    res.status(badJson ? 400 : 500).json({ error: badJson ? 'Request body must be valid JSON.' : 'Something went wrong on the server.' })
  }
  app.use(onError)

  return app
}
