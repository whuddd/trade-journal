import { useCallback, useEffect, useState } from 'react'
import { api, messageOf } from './api.js'
import ConfirmDelete from './ConfirmDelete.jsx'
import { useToast } from './motion.jsx'

export default function Rules() {
  const [rules, setRules] = useState(/** @type {{id: number, text: string}[] | null} */ (null))
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(/** @type {{id: number, text: string} | null} */ (null))
  const [error, setError] = useState('')
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setRules(await api.listRules())
    } catch (e) {
      setError(messageOf(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /**
   * @param {() => Promise<unknown>} work
   * @param {string} done toast text on success
   */
  async function run(work, done) {
    setError('')
    try {
      await work()
      await load()
      toast(done, 'up')
      return true
    } catch (e) {
      setError(messageOf(e))
      return false
    }
  }

  /** @param {import('react').FormEvent} event */
  async function add(event) {
    event.preventDefault()
    if (await run(() => api.createRule(text), 'Rule added')) setText('')
  }

  /** @param {import('react').FormEvent} event */
  async function rename(event) {
    event.preventDefault()
    if (editing && (await run(() => api.updateRule(editing.id, editing.text), 'Rule renamed'))) setEditing(null)
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Checklist rules</h2>
        <span className="count">{rules ? rules.length : ''}</span>
      </header>
      <form className="panel-body rule-add" onSubmit={add}>
        <input aria-label="New rule" placeholder="e.g. Monthly and weekly trend agree" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn primary">Add rule</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {rules && rules.length === 0 && (
        <p className="empty">
          No rules yet. Rules are the checklist you grade every trade against, like "defined invalidation before entry".
          Stats will show whether following each one actually pays.
        </p>
      )}
      {rules && rules.length > 0 && (
        <div className="table-wrap">
          <table className="grid">
            <tbody>
              {rules.map((rule, index) => (
                <tr key={rule.id} style={{ '--i': Math.min(index, 12) }}>
                  <td className="muted rule-num">{String(index + 1).padStart(2, '0')}</td>
                  <td style={{ width: '100%' }} className="wrap">
                    {editing?.id === rule.id ? (
                      <form className="inline" onSubmit={rename}>
                        <input aria-label="Rule text" value={editing.text} onChange={(e) => setEditing({ id: rule.id, text: e.target.value })} />
                        <button type="submit" className="btn">Save</button>
                        <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                      </form>
                    ) : (
                      rule.text
                    )}
                  </td>
                  <td className="actions">
                    {editing?.id !== rule.id && (
                      <div className="action-row">
                        <button type="button" onClick={() => setEditing({ id: rule.id, text: rule.text })}>Rename</button>
                        <ConfirmDelete warning="Removes its ticks from past trades." onConfirm={() => run(() => api.deleteRule(rule.id), 'Rule deleted')} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
