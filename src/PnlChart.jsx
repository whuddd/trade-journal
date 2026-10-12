import { useState } from 'react'
import { money, shortDate, tone } from './format.js'

const W = 720
const H = 220
const PAD = 32

/** @param {{points: {id: number, exit_date: string, pnl: number, cumulative: number}[]}} props */
export default function PnlChart({ points }) {
  const [hover, setHover] = useState(/** @type {number | null} */ (null))
  if (points.length === 0) return null
  const values = [0, ...points.map((p) => p.cumulative)]
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  /** @param {number} i */
  const x = (i) => (points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1))
  /** @param {number} v */
  const y = (v) => PAD + ((max - v) * (H - 2 * PAD)) / span
  const zero = y(0)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(' ')
  const area = `${path} L${x(points.length - 1).toFixed(1)},${zero.toFixed(1)} L${x(0).toFixed(1)},${zero.toFixed(1)} Z`
  const last = points[points.length - 1]

  /** @param {import('react').PointerEvent<SVGSVGElement>} event */
  function track(event) {
    const box = event.currentTarget.getBoundingClientRect()
    const vx = ((event.clientX - box.left) / box.width) * W
    const step = points.length === 1 ? 1 : (W - 2 * PAD) / (points.length - 1)
    setHover(Math.max(0, Math.min(points.length - 1, Math.round((vx - PAD) / step))))
  }

  const h = hover === null ? null : points[hover]

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Cumulative P/L over ${points.length} closed trades, ending at ${money(last.cumulative)}`}
        onPointerMove={track}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="pnl-above"><rect x="0" y="0" width={W} height={zero} /></clipPath>
          <clipPath id="pnl-below"><rect x="0" y={zero} width={W} height={H - zero} /></clipPath>
          <linearGradient id="pnl-up-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--up)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--up)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="pnl-down-fill" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="var(--down)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--down)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => {
          const gy = PAD + (i * (H - 2 * PAD)) / 4
          return <line key={i} className="gridline" x1={PAD} x2={W - PAD} y1={gy} y2={gy} />
        })}
        <line className="zero" x1={PAD} x2={W - PAD} y1={zero} y2={zero} />
        <g className="chart-fill">
          <path d={area} fill="url(#pnl-up-fill)" clipPath="url(#pnl-above)" />
          <path d={area} fill="url(#pnl-down-fill)" clipPath="url(#pnl-below)" />
        </g>
        <path d={path} className="up-line draw" pathLength="1" clipPath="url(#pnl-above)" />
        <path d={path} className="down-line draw" pathLength="1" clipPath="url(#pnl-below)" />
        {points.map((p, i) => (
          <circle
            key={p.id}
            cx={x(i)}
            cy={y(p.cumulative)}
            r={hover === i ? 5 : 2.5}
            className={`dot ${p.cumulative >= 0 ? 'dot-up' : 'dot-down'}`}
            style={{ animationDelay: `${0.25 + (i / points.length) * 0.9}s` }}
          />
        ))}
        {h && hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD / 2} y2={H - PAD / 2} />}
        <circle cx={x(points.length - 1)} cy={y(last.cumulative)} r="7" className={`pulse ${last.cumulative >= 0 ? 'dot-up' : 'dot-down'}`} />
      </svg>
      {/* Rendered as HTML, not SVG <text>, so the label keeps a fixed pixel
          size instead of shrinking with the viewBox at phone width. */}
      <span className="chart-label chart-label-top">{money(max)}</span>
      <span className="chart-label chart-label-bottom">{money(min)}</span>
      {h && hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.cumulative) / H) * 100}%` }} aria-hidden="true">
          <div className="muted">#{hover + 1} · {shortDate(h.exit_date)}</div>
          <div>trade <span className={tone(h.pnl)}>{money(h.pnl)}</span></div>
          <div>total <b className={tone(h.cumulative)}>{money(h.cumulative)}</b></div>
        </div>
      )}
    </div>
  )
}
