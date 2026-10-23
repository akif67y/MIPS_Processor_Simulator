// Reusable SVG shapes that copy the look of the Patterson & Hennessy datapath figures
// used in the slides (Ch. 4 Part 1 slides 26/32). Coordinates are in the slide-32
// viewBox (0 0 1520 1180).

import type { ReactNode } from 'react'

/** How an element is drawn.
 *  normal   – slide colours (black data, blue control)
 *  chosen   – on the path that is actually used this cycle
 *  computed – computed this cycle but not chosen by the mux
 *  faded    – not part of the current topic
 *  added    – hardware newly added for an extension (e.g. bne)
 *  hidden   – not drawn at all
 *  Pipeline lab only:
 *  exmem    – value forwarded from the EX/MEM pipeline register (Forward = 10)
 *  memwb    – value forwarded from the MEM/WB pipeline register (Forward = 01)
 *  hazard   – hazard detection unit / stall signals
 *  rf       – register-file write (first half) and read (second half)
 *  Control-hazard lab only:
 *  branch   – taken-branch path (target, PCSrc = 1)
 *  flush    – flush signals and flushed instructions */
export type Look = 'normal' | 'chosen' | 'computed' | 'faded' | 'added' | 'hidden' | 'exmem' | 'memwb' | 'hazard' | 'rf' | 'branch' | 'flush'

export const COLORS = {
  data: '#111111',
  ctrl: '#24519e',
  faded: '#cdcdcd',
  fadedText: '#b9b9b9',
  chosen: '#e8590c',
  computed: '#8f7cc8',
  added: '#2f9e44',
  exmem: '#e8590c',
  memwb: '#7048e8',
  hazard: '#e03131',
  rf: '#0c8599',
  branch: '#2b8a3e',
  flush: '#d6336c',
}

/** Looks drawn with a heavier stroke because they are the point of the picture. */
export function hot(look: Look) {
  return look === 'chosen' || look === 'exmem' || look === 'memwb' || look === 'hazard' || look === 'rf' || look === 'branch' || look === 'flush'
}
const OWN = ['exmem', 'memwb', 'hazard', 'rf', 'branch', 'flush'] as const
const own = (look: Look): look is (typeof OWN)[number] => (OWN as readonly string[]).includes(look)

export type Kind = 'data' | 'ctrl'

export function strokeOf(look: Look, kind: Kind = 'data') {
  if (look === 'chosen') return COLORS.chosen
  if (look === 'computed') return COLORS.computed
  if (look === 'faded') return COLORS.faded
  if (look === 'added') return COLORS.added
  if (own(look)) return COLORS[look]
  return kind === 'ctrl' ? COLORS.ctrl : COLORS.data
}

export function textOf(look: Look, kind: Kind = 'data') {
  if (look === 'faded') return COLORS.fadedText
  if (look === 'added') return COLORS.added
  if (own(look)) return COLORS[look]
  return kind === 'ctrl' ? COLORS.ctrl : COLORS.data
}

const FONT = 'Arial, Helvetica, sans-serif'

type Pt = [number, number]

/** A wire: a poly-line, optional arrowhead at the end, optional junction dots. */
export function Wire(props: {
  pts: Pt[]
  look: Look
  kind?: Kind
  thick?: boolean
  arrow?: boolean
  dots?: Pt[]
}) {
  const { pts, look, kind = 'data', thick, arrow = true, dots = [] } = props
  if (look === 'hidden') return null
  const c = strokeOf(look, kind)
  const base = thick ? 6 : 2.6
  const w = hot(look) ? base + 3 : look === 'computed' ? base + 1.2 : base
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')
  let head: ReactNode = null
  if (arrow && pts.length > 1) {
    const [x2, y2] = pts[pts.length - 1]
    const [x1, y1] = pts[pts.length - 2]
    const a = Math.atan2(y2 - y1, x2 - x1)
    const L = 16 + (hot(look) ? 4 : 0)
    const W = 7 + (hot(look) ? 2 : 0)
    const p1: Pt = [x2 - L * Math.cos(a) + W * Math.sin(a), y2 - L * Math.sin(a) - W * Math.cos(a)]
    const p2: Pt = [x2 - L * Math.cos(a) - W * Math.sin(a), y2 - L * Math.sin(a) + W * Math.cos(a)]
    head = <polygon points={`${x2},${y2} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`} fill={c} />
  }
  return (
    <g>
      <path d={d} fill="none" stroke={c} strokeWidth={w} strokeLinejoin="miter" />
      {head}
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={hot(look) ? 8 : 6.5} fill={c} />
      ))}
    </g>
  )
}

/** Plain text label (wire names such as "Instruction [25–0]"). */
export function Label(props: {
  x: number
  y: number
  look: Look
  kind?: Kind
  size?: number
  bold?: boolean
  anchor?: 'start' | 'middle' | 'end'
  children: ReactNode
}) {
  const { x, y, look, kind = 'data', size = 24, bold, anchor = 'start', children } = props
  if (look === 'hidden') return null
  return (
    <text
      x={x}
      y={y}
      fontFamily={FONT}
      fontSize={size}
      fontWeight={bold ? 700 : 400}
      textAnchor={anchor}
      fill={textOf(look, kind)}
    >
      {children}
    </text>
  )
}

/** Multiplexer: the tall pill with "M u x" stacked and the input numbers near the inputs. */
export function Mux(props: {
  x: number
  y: number
  w: number
  h: number
  top: string
  bottom: string
  look: Look
}) {
  const { x, y, w, h, top, bottom, look } = props
  if (look === 'hidden') return null
  const c = strokeOf(look)
  const t = textOf(look)
  const cx = x + w / 2
  const sw = hot(look) ? 4.5 : 2.6
  return (
    <g fontFamily={FONT}>
      <rect x={x} y={y} width={w} height={h} rx={w / 2} ry={w / 2} fill="white" stroke={c} strokeWidth={sw} />
      <text x={x + 8} y={y + 27} fontSize={22} fill={t}>{top}</text>
      <text x={x + 8} y={y + h - 8} fontSize={22} fill={t}>{bottom}</text>
      {['M', 'u', 'x'].map((ch, i) => (
        <text key={ch} x={cx} y={y + h / 2 + (i - 1) * 21 + 8} fontSize={22} fontWeight={700} textAnchor="middle" fill={t}>
          {ch}
        </text>
      ))}
    </g>
  )
}

/** Mux with any number of inputs; each input's number is drawn next to where its wire enters. */
export function MuxN(props: { x: number; y: number; w: number; h: number; inputs: { t: string; y: number }[]; look: Look }) {
  const { x, y, w, h, inputs, look } = props
  if (look === 'hidden') return null
  const c = strokeOf(look)
  const t = textOf(look)
  const cy = y + h / 2
  return (
    <g fontFamily={FONT}>
      <rect x={x} y={y} width={w} height={h} rx={w / 2} ry={w / 2} fill="white" stroke={c} strokeWidth={hot(look) ? 4.5 : 2.6} />
      {inputs.map((i) => (
        <text key={i.t} x={x + 5} y={i.y + 8} fontSize={19} fill={t}>{i.t}</text>
      ))}
      {['M', 'u', 'x'].map((ch, i) => (
        <text key={ch} x={x + w - 13} y={cy + (i - 1) * 21 + 8} fontSize={21} fontWeight={700} textAnchor="middle" fill={t}>{ch}</text>
      ))}
    </g>
  )
}

/** Adder / ALU: trapezoid with the notch on the left side. */
export function Adder(props: {
  lx: number
  lt: number
  lb: number
  rx: number
  rt: number
  rb: number
  look: Look
  children?: ReactNode
}) {
  const { lx, lt, lb, rx, rt, rb, look, children } = props
  if (look === 'hidden') return null
  const c = strokeOf(look)
  const mid = (lt + lb) / 2
  const nh = 23
  const nd = 16
  const pts = [
    [lx, lt],
    [rx, rt],
    [rx, rb],
    [lx, lb],
    [lx, mid + nh],
    [lx + nd, mid],
    [lx, mid - nh],
  ]
    .map((p) => p.join(','))
    .join(' ')
  return (
    <g fontFamily={FONT}>
      <polygon points={pts} fill="white" stroke={c} strokeWidth={hot(look) ? 4.5 : 2.6} strokeLinejoin="miter" />
      {children}
    </g>
  )
}

/** Ellipse unit: Shift left 2, Sign-extend, ALU control, Control. */
export function Oval(props: {
  cx: number
  cy: number
  rx: number
  ry: number
  lines: string[]
  look: Look
  kind?: Kind
  size?: number
}) {
  const { cx, cy, rx, ry, lines, look, kind = 'data', size = 25 } = props
  if (look === 'hidden') return null
  const c = strokeOf(look, kind)
  const t = textOf(look, kind)
  const lh = size * 1.25
  const y0 = cy - ((lines.length - 1) * lh) / 2 + size * 0.35
  return (
    <g fontFamily={FONT}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="white" stroke={c} strokeWidth={hot(look) ? 4.5 : 2.6} />
      {lines.map((l, i) => (
        <text key={i} x={cx} y={y0 + i * lh} fontSize={size} fontWeight={700} textAnchor="middle" fill={t}>
          {l}
        </text>
      ))}
    </g>
  )
}

/** Rectangle unit: PC, Instruction memory, Registers, Data memory. */
export function Box(props: { x: number; y: number; w: number; h: number; look: Look; children?: ReactNode }) {
  const { x, y, w, h, look, children } = props
  if (look === 'hidden') return null
  return (
    <g fontFamily={FONT}>
      <rect x={x} y={y} width={w} height={h} fill="white" stroke={strokeOf(look)} strokeWidth={hot(look) ? 4.5 : 2.6} />
      {children}
    </g>
  )
}

/** AND gate: flat left side, round right side. */
export function AndGate(props: { x: number; y: number; w: number; h: number; look: Look }) {
  const { x, y, w, h, look } = props
  if (look === 'hidden') return null
  const r = h / 2
  const flat = w - r
  const d = `M${x},${y} H${x + flat} A${r},${r} 0 0 1 ${x + flat},${y + h} H${x} Z`
  return <path d={d} fill="white" stroke={strokeOf(look, 'ctrl')} strokeWidth={hot(look) ? 4.5 : 2.6} />
}

/** OR gate: curved back, pointed front. Inputs land about 5 px inside the left edge. */
export function OrGate(props: { x: number; y: number; w: number; h: number; look: Look }) {
  const { x, y, w, h, look } = props
  if (look === 'hidden') return null
  const d = `M${x},${y} Q${x + w * 0.62},${y} ${x + w},${y + h / 2} Q${x + w * 0.62},${y + h} ${x},${y + h} Q${x + w * 0.3},${y + h / 2} ${x},${y} Z`
  return <path d={d} fill="white" stroke={strokeOf(look, 'ctrl')} strokeWidth={hot(look) ? 4.5 : 2.6} />
}

/** NOT gate pointing right: triangle plus bubble. (x, y) is the input point. */
export function NotGate(props: { x: number; y: number; look: Look; size?: number }) {
  const { x, y, look, size = 24 } = props
  if (look === 'hidden') return null
  const c = strokeOf(look, 'ctrl')
  const sw = hot(look) ? 4 : 2.6
  const half = size * 0.6
  return (
    <g>
      <polygon points={`${x},${y - half} ${x},${y + half} ${x + size},${y}`} fill="white" stroke={c} strokeWidth={sw} strokeLinejoin="miter" />
      <circle cx={x + size + 5} cy={y} r={5} fill="white" stroke={c} strokeWidth={sw} />
    </g>
  )
}

/** Bus-width slash with its bit count, e.g. "/ 26". */
export function Slash(props: { x: number; y: number; n: string; look: Look; labelBelow?: boolean }) {
  const { x, y, n, look, labelBelow = true } = props
  if (look === 'hidden') return null
  const c = strokeOf(look)
  return (
    <g fontFamily={FONT}>
      <line x1={x - 9} y1={y - 11} x2={x + 9} y2={y + 11} stroke={c} strokeWidth={2.4} />
      <text x={x + 4} y={labelBelow ? y + 38 : y - 18} fontSize={24} textAnchor="middle" fill={textOf(look)}>
        {n}
      </text>
    </g>
  )
}

/** Small value tag drawn on top of the diagram (e.g. "PC+4 = 0x44"). */
export function Tag(props: { x: number; y: number; text: string; color?: string; anchor?: 'start' | 'middle' | 'end' }) {
  const { x, y, text, color = COLORS.chosen, anchor = 'start' } = props
  const w = text.length * 12.6 + 18
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w
  return (
    <g fontFamily="Consolas, ui-monospace, monospace">
      <rect x={left} y={y - 24} width={w} height={34} rx={7} fill="white" stroke={color} strokeWidth={2.2} opacity={0.96} />
      <text x={left + 9} y={y} fontSize={22} fontWeight={700} fill={color}>
        {text}
      </text>
    </g>
  )
}
