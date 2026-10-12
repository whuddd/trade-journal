import { useState } from 'react'

/** @param {{onConfirm: () => void, warning?: string, label?: string}} props */
export default function ConfirmDelete({ onConfirm, warning = 'Delete this?', label = 'Delete' }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return <button type="button" onClick={() => setAsking(true)}>{label}</button>
  }
  return (
    <span className="confirm">
      <span>{warning}</span>
      <button type="button" className="danger" onClick={onConfirm}>Yes, delete</button>
      <button type="button" onClick={() => setAsking(false)}>No</button>
    </span>
  )
}
