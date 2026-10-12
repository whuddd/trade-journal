// @vitest-environment node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localDay } from './journal.js'

const entry = fileURLToPath(new URL('./index.js', import.meta.url))

let dir = ''
/** @type {import('node:child_process').ChildProcess[]} */
let children = []

/** @param {string} dbPath */
async function startServer(dbPath) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, PORT: '0', DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const url = await new Promise((resolve, reject) => {
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += chunk
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) resolve(match[0])
    })
    child.stderr?.on('data', (chunk) => {
      output += chunk
    })
    child.once('exit', (code) => reject(new Error(`Server exited before listening (code ${code}):\n${output}`)))
  })
  return { child, url: /** @type {string} */ (url) }
}

/** @param {import('node:child_process').ChildProcess} child */
async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  await exited
}

/**
 * @param {string} url
 * @param {string} path
 * @param {{method?: string, body?: unknown}} [options]
 */
async function call(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  expect(response.ok, `${options.method ?? 'GET'} ${path} -> ${response.status}`).toBe(true)
  return response.json()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'journal-restart-'))
  children = []
})

afterEach(async () => {
  await Promise.all(children.map(stopServer))
  rmSync(dir, { recursive: true, force: true })
})

describe('restart', () => {
  it('keeps a trade, its checklist tick, its edit history and the streak across a server restart', { timeout: 20000 }, async () => {
    const dbPath = join(dir, 'journal.db')
    const first = await startServer(dbPath)

    const rule = await call(first.url, '/api/rules', { method: 'POST', body: { text: 'Trend agrees on monthly and weekly' } })
    const openTrade = {
      ticker: 'SPY', option_type: 'call', strike: 450, expiration: '2026-10-17', contracts: 2,
      entry_date: '2026-09-20', entry_premium: 2.35, setup: '4H breakout', notes: 'Held the 4H level.',
      checklist: [{ rule_id: rule.id, followed: true }],
    }
    const created = await call(first.url, '/api/trades', { method: 'POST', body: openTrade })
    const closedTrade = { ...openTrade, exit_date: '2026-09-25', exit_premium: 3.1 }
    await call(first.url, `/api/trades/${created.id}`, { method: 'PUT', body: closedTrade })
    await call(first.url, `/api/trades/${created.id}`, { method: 'PUT', body: { ...closedTrade, exit_premium: 3.4 } })

    await stopServer(first.child)
    expect(first.child.exitCode).toBe(0)

    const second = await startServer(dbPath)
    const back = await call(second.url, `/api/trades/${created.id}`)
    expect(back).toMatchObject({
      ticker: 'SPY', status: 'closed', exit_premium: 3.4, pnl: 210, notes: 'Held the 4H level.',
      checklist: [{ rule_id: rule.id, followed: true }],
    })
    expect(back.edits).toEqual([expect.objectContaining({ field: 'exit_premium', old_value: '3.1', new_value: '3.4' })])

    const activity = await call(second.url, '/api/activity')
    expect(activity.days).toContain(localDay())
    expect(activity.current_streak).toBeGreaterThanOrEqual(1)
  })
})
