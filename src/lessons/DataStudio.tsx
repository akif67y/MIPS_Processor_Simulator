// The Data hazards lab as a full-window studio (design "Option 3"): the datapath on a stage with a
// camera that follows the step, numbered pins linking the script to the hardware, inspect cards,
// and a script column that reads the cycle. Phone width keeps the classic page until it is designed.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PipelineDatapath } from '../pipeline/PipelineDatapath'
import { instrColor } from '../pipeline/colors'
import { EXAMPLES } from '../pipeline/examples'
import { buildSteps, explain, PHASES, resultTone, wholeCycle, type Line, type Phase, type Stage, type StageCard, type Step, type ViewMode } from '../pipeline/explain'
import { dependences, real, regName, type Cycle, type Instr, type Simulation, type Squash } from '../pipeline/engine'
import { pad, sheetBox, union, unitBox, unitName, unitPin, type Box, type Unit } from '../pipeline/units'
import { NAV, NAV_GROUPS } from '../nav'
import {
  Chip, DATA_LESSON, DataMemory, DataRules, FORWARD_RULES, LOAD_USE_RULE, Latch, Md, PipelineLab, ProgramTable, RegisterFile,
  chartRows, ctrl3, fields, run, usePref,
} from './PipelineLab'
import './studio.css'

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** Phone width is not designed yet: it keeps the classic page. */
export function DataHazardLab() {
  const phone = useMedia('(max-width: 699px)')
  return phone ? <PipelineLab lesson={DATA_LESSON} /> : <DataStudio />
}

// ---------- camera ----------

/** What each step frames before the units its lines pin are added. */
const PHASE_UNITS: Record<Phase, Unit[]> = {
  edge: [],
  wb: ['memwb', 'regs', 'wbMux'],
  id: ['pc', 'imem', 'ifid', 'control', 'regs', 'hdu', 'idex'],
  ex: ['idex', 'muxA', 'muxB', 'alu', 'aluCtl', 'regDst', 'fu', 'exmem'],
  br: [],
  all: [],
}
const CAMERA_NAME: Record<Phase, string> = { edge: 'whole datapath', wb: 'WB and the register file', id: 'IF and ID', ex: 'EX and MEM', br: 'the branch', all: 'whole datapath' }
/** Stages a step is about (ringed in the header; the others fade). */
const FOCUS: Record<Phase, Stage[] | null> = { edge: null, wb: ['WB'], id: ['IF', 'ID'], ex: ['EX', 'MEM'], br: null, all: null }

const BARS: Unit[] = ['ifid', 'idex', 'exmem', 'memwb']

/** The union of what the step uses; EX · MEM also takes MEM/WB when MEM holds a load or store.
 *  Pipeline registers run the full height of the sheet, so they widen the frame but do not stretch it. */
function cameraRegion(c: Cycle, phase: Phase, lines: Line[]): Box | null {
  if (phase === 'edge' || phase === 'all' || phase === 'br') return null
  const units = [...PHASE_UNITS[phase], ...lines.flatMap((l) => (l.at ? [l.at] : []))]
  const m = real(c.at.exmem)
  if (phase === 'ex' && m && (m.ctrl.MemRead || m.ctrl.MemWrite)) units.push('dmem', 'memwb')
  const body = union(units.filter((u) => !BARS.includes(u)).map((u) => unitBox(u)))
  const bars = union(units.filter((u) => BARS.includes(u)).map((u) => unitBox(u)))
  if (!body) return bars
  if (!bars) return body
  const x0 = Math.min(body.x, bars.x), x1 = Math.max(body.x + body.w, bars.x + bars.w)
  return { x: x0, y: body.y, w: x1 - x0, h: body.h }
}

/** The largest box of the given aspect ratio that fits `size`, centred. */
function contain(aspect: number, size: { w: number; h: number }) {
  const w = Math.min(size.w, size.h * aspect), h = w / aspect
  return { w, h, left: (size.w - w) / 2, top: (size.h - h) / 2 }
}

const sameBox = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5
const ease = (t: number) => 1 - (1 - t) ** 3

/** Moves the svg's viewBox to `target` in 400 ms (instant with reduced motion) without re-rendering the diagram.
 *  Returns the box on screen, for the pins and the inspect card. */
function useCamera(target: Box, host: HTMLElement | null): Box {
  const [box, setBox] = useState(target)
  const cur = useRef(target)
  useLayoutEffect(() => {
    const svg = host?.querySelector('svg')
    const set = (b: Box) => { cur.current = b; svg?.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`); setBox(b) }
    const from = cur.current
    if (sameBox(from, target)) { set(target); return }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { set(target); return }
    set(from)
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / 400)), e = ease(k) // rAF time can be a little before t0
      set({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e })
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, host])
  return box
}

/** The element is passed in (from a callback ref), so the observer attaches whenever it mounts. */
function useSize(el: HTMLElement | null) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [el])
  return size
}

// ---------- pins ----------

type Item = { num: number | null; lines: Line[] }
type Pin = { num: number; at: Unit; label?: string }

function pinLabel(ls: Line[]) {
  const label = ls.find((l) => l.label)?.label
  if (label) return label
  return ls.find((l) => l.result && (resultTone(l.result) || l.at === 'hdu'))?.result
}

/** Numbers the lines by location: lines at the same unit share a number, "·" for none. */
function numberLines(lines: Line[]): { items: Item[]; pins: Pin[] } {
  const nums = new Map<Unit, number>()
  const items: Item[] = []
  for (const l of lines) {
    let num: number | null = null
    if (l.at) {
      if (!nums.has(l.at)) nums.set(l.at, nums.size + 1)
      num = nums.get(l.at)!
    }
    const last = items[items.length - 1]
    if (last && num !== null && last.num === num) last.lines.push(l)
    else items.push({ num, lines: [l] })
  }
  return { items, pins: [...nums].map(([at, num]) => ({ at, num, label: pinLabel(lines.filter((l) => l.at === at)) })) }
}

/** Whole cycle: a stage gets a pin when one of its badges means something (not the muted ones). */
function cardPin(card: StageCard): Unit | null {
  const b = card.badges.find((x) => x.tone && x.tone !== 'muted')
  if (!b) return null
  if (card.stage === 'WB') return 'rfWrite'
  if (card.stage === 'MEM') return 'dmem'
  if (card.stage === 'EX') return b.text.startsWith('ForwardB') ? 'muxB' : 'muxA'
  if (card.stage === 'ID') return b.tone === 'hazard' ? 'hdu' : b.tone === 'rf' ? 'rfRead' : 'ifid'
  return 'imem'
}

// ---------- small parts ----------

const TAG: Record<string, string> = { ex: 'ex', mem: 'mem', hazard: 'hazard', rf: 'rf', branch: 'branch', flush: 'flush', muted: 'muted' }
const positive = (l: Line) => (l.result ? !!resultTone(l.result) : true)

function Checks({ line, all }: { line: Line; all: boolean }) {
  if (!line.checks) return null
  const tone = line.result ? resultTone(line.result) : null
  if (!all && !positive(line)) return line.result ? <span className="st-checks"><span className="st-ck no">⇒ {line.result}</span></span> : null
  return <span className="st-checks">
    {line.checks.map((k, i) => <span key={i} className={`st-ck ${k.ok ? '' : 'no'}`}>{k.ok ? '✔' : '✘'} {k.text}</span>)}
    {line.result && <span className={`st-ck res ${tone ?? 'no'}`}>⇒ {line.result}</span>}
  </span>
}

function ItemView({ item, all }: { item: Item; all: boolean }) {
  return <li className={`st-item ${item.num === null ? 'nopin' : ''}`}>
    <span className={`st-num ${item.num === null ? 'dot' : ''}`} aria-hidden="true">{item.num ?? '·'}</span>
    <div className="st-item-body">
      {item.num !== null && <span className="sr-only">Pin {item.num}: </span>}
      {item.lines.map((l, k) => <div key={k} className={`st-line ${l.tone ?? ''}`}>
        <span><Md text={l.text} /></span>
        <Checks line={l} all={all} />
      </div>)}
    </div>
  </li>
}

function Popover({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className: string }) {
  if (!open) return null
  return <>
    <div className="st-backdrop" onClick={onClose} />
    <div className={`st-pop ${className}`}>{children}</div>
  </>
}

function packetChip(p: { instr: Instr; bubble?: boolean; squashed?: Squash } | null | undefined) {
  if (!p) return <Chip i={null} />
  return <Chip i={p.squashed ? p.squashed.instr : p.instr} bubble={!!p.bubble && !p.squashed} gone={p.squashed} />
}

// ---------- the plan (timing chart, large) ----------

function PlanChart({ sim, now, onSeek }: { sim: Simulation; now: number | null; onSeek: (k: number) => void }) {
  const rows = chartRows(sim)
  const N = sim.cycles.length
  const marks = new Map<string, '10' | '01' | 'RF'>()
  sim.cycles.forEach((c) => {
    const e = real(c.at.idex)
    if (e && c.ex) for (const f of [c.ex.fa, c.ex.fb]) {
      if (f.sel === '00' || (f.unused && e.instr.op !== 'sw')) continue
      if (!marks.has(`${e.seq}:${c.n}`) || f.sel === '10') marks.set(`${e.seq}:${c.n}`, f.sel)
    }
    const d = c.at.ifid
    if (c.id && c.wb?.writes && (c.id.sameCycleRs || c.id.sameCycleRt) && d && !d.squashed) {
      marks.set(`${c.at.memwb!.seq}:${c.n}`, 'RF')
      marks.set(`${d.seq}:${c.n}`, 'RF')
    }
  })
  const used = new Set(marks.values())
  const held = rows.some((r) => [...r.cells.values()].some((x) => x.repeat))
  const bubbles = rows.some((r) => r.bubble)
  const cols = `minmax(150px, 200px) repeat(${N}, minmax(36px, 1fr))`
  return <div className="st-plan-chart" role="table" aria-label="Instruction by instruction, cycle by cycle">
    <div className="st-plan-row head" role="row" style={{ gridTemplateColumns: cols }}>
      <span role="columnheader" />
      {sim.cycles.map((c) => <button key={c.n} role="columnheader" className={now === c.n ? 'now' : ''} onClick={() => onSeek(c.n - 1)} aria-label={`Go to cycle ${c.n}`} title={`Go to cycle ${c.n}`}>{c.n}</button>)}
    </div>
    {rows.map((r) => <div key={r.seq} className="st-plan-row" role="row" style={{ gridTemplateColumns: cols }}>
      <span className="st-plan-who" role="rowheader">
        {r.bubble ? <span className="pl-chip bubble">nop</span> : <Chip i={r.instr} gone={r.gone} />}
        <code className={r.bubble ? 'bubble' : ''}>{r.bubble ? 'bubble (stall)' : r.instr.text}</code>
      </span>
      {Array.from({ length: N }, (_, k) => {
        const n = k + 1
        const cell = r.cells.get(n)
        const mark = marks.get(`${r.seq}:${n}`)
        const cls = !cell ? 'empty' : r.bubble ? 'bubble' : cell.gone ? 'gone' : cell.repeat ? 'held' : ''
        return <span key={n} role="cell" className={`st-cell ${cls} ${now !== null && n > now ? 'future' : ''}`} style={cell && !r.bubble ? { ['--c' as string]: instrColor(r.instr) } : undefined}>
          {cell ? (r.bubble ? 'nop' : cell.stage) : ''}
          {mark && <span className={`st-mk ${mark === '10' ? 'ex' : mark === '01' ? 'mem' : 'rf'}`}>{mark}</span>}
        </span>
      })}
    </div>)}
    <div className="st-plan-legend">
      {held && <span><i className="held" />held by a stall</span>}
      {bubbles && <span><i className="bubble" />bubble</span>}
      {used.has('10') && <span><b className="st-mk ex">10</b>forwarded from EX/MEM</span>}
      {used.has('01') && <span><b className="st-mk mem">01</b>forwarded from MEM/WB</span>}
      {used.has('RF') && <span><b className="st-mk rf">RF</b>register file</span>}
    </div>
  </div>
}

// ---------- inspect cards ----------

function InspectBody({ u, c, step, sim, onAll }: { u: Unit; c: Cycle; step: Step; sim: Simulation; onAll: (d: Drawer) => void }) {
  if (u === 'ifid' || u === 'idex' || u === 'exmem' || u === 'memwb') {
    const now = fields(c.at, u, sim.hw), next = fields(c.next, u, sim.hw)
    const pkt = c.at[u], nextPkt = c.next[u]
    const names = [...new Set([...now, ...next].map((x) => x[0]))]
    return <>
      <p className="st-insp-who">holds {packetChip(pkt)} <code>{pkt ? (pkt.squashed ? pkt.squashed.instr.text : pkt.instr.text) : 'nothing'}</code></p>
      {names.length > 0 ? <table className="st-insp-table">
        <thead><tr><th>Field</th><th>Now</th><th>Next edge {nextPkt ? <>· {packetChip(nextPkt)}</> : null}</th></tr></thead>
        <tbody>{names.map((n) => {
          const v = now.find((x) => x[0] === n)?.[1] ?? '—', nv = next.find((x) => x[0] === n)?.[1] ?? '—'
          return <tr key={n} className={v !== nv ? 'changed' : ''}><th>{n}</th><td>{v}</td><td>{v === nv ? <span className="muted">same</span> : <b>{nv}</b>}</td></tr>
        })}</tbody>
      </table> : <p className="muted">Empty.</p>}
      <button className="st-link" onClick={() => onAll('latches')}>All pipeline registers →</button>
    </>
  }
  if (u === 'regs') return <><RegisterFile c={c} phase={step.phase} /><button className="st-link" onClick={() => onAll('state')}>Registers &amp; memory →</button></>
  if (u === 'dmem') return <><DataMemory c={c} sim={sim} /><button className="st-link" onClick={() => onAll('state')}>Registers &amp; memory →</button></>
  if (u === 'fu') return <><p className="st-insp-slide">Slides 61 and 64</p><pre className="st-pre">{FORWARD_RULES}</pre><button className="st-link" onClick={() => onAll('rules')}>Hardware rules →</button></>
  if (u === 'hdu') return <><p className="st-insp-slide">Slide 69 · how it stalls: slide 72</p><pre className="st-pre">{LOAD_USE_RULE}</pre><button className="st-link" onClick={() => onAll('rules')}>Hardware rules →</button></>
  if (u === 'control') {
    const d = c.id
    if (!d || c.at.ifid?.squashed) return <p className="muted">No instruction in ID this cycle, so Control sends nothing.</p>
    const g = ctrl3(d.ctrl, d.instr.op, false)
    const stalled = c.hazard.stall && !c.hazard.overridden
    return <>
      <p className="st-insp-who">decodes {packetChip(c.at.ifid)} <code>{d.instr.text}</code></p>
      <table className="st-insp-table"><tbody>
        <tr><th>WB</th><td>{g.WB}</td></tr><tr><th>M</th><td>{g.M}</td></tr><tr><th>EX</th><td>{g.EX}</td></tr>
      </tbody></table>
      {stalled && <p className="st-insp-note hazard">Stall = 1: the control mux sends 0s into ID/EX instead (slide 72).</p>}
      <p className="st-insp-slide">Control signals: slide 51</p>
    </>
  }
  if (u === 'aluCtl') {
    const e = real(c.at.idex)
    if (!e || !c.ex) return <p className="muted">EX holds {c.at.idex ? 'a bubble' : 'nothing'}: ALU control has no operation to choose.</p>
    const op = e.ctrl.ALUOp.toString(2).padStart(2, '0')
    const funct = e.ctrl.ALUOp === 2 ? (e.imm & 63).toString(2).padStart(6, '0') : null
    return <>
      <p className="st-insp-who">for {packetChip(c.at.idex)} <code>{e.instr.text}</code></p>
      <p className="st-insp-big"><code>{op}{funct ? ` + ${funct}` : ''} → {c.ex.aluCtl.name}</code></p>
      <p className="muted">ALUOp {op}{funct ? ' (R-format) with the funct bits' : op === '00' ? ': add, for a load or store address' : ': subtract, for a branch'} chooses the ALU operation.</p>
    </>
  }
  return null
}

// ---------- the page ----------

type Drawer = 'latches' | 'state' | 'rules' | 'edit'
const DRAWER_TITLE: Record<Drawer, string> = { latches: 'Pipeline registers', state: 'Registers & memory', rules: 'Hardware rules', edit: 'Edit code' }
const LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'exmem', label: 'EX/MEM → ALU (Forward = 10)', color: 'var(--fwd-exmem)' },
  { key: 'memwb', label: 'MEM/WB → ALU (Forward = 01)', color: 'var(--fwd-memwb)' },
  { key: 'hazard', label: 'hazard detection / stall', color: 'var(--hazard)' },
  { key: 'rf', label: 'register file write / read', color: 'var(--regfile)' },
  { key: 'ctrl', label: 'control', color: 'var(--wire-ctrl)' },
  { key: 'data', label: 'data', color: 'var(--wire-data)' },
  { key: 'faded', label: 'not used now', color: 'var(--wire-faded)' },
]
const STAGES: Stage[] = ['IF', 'ID', 'EX', 'MEM', 'WB']

const Diagram = memo(PipelineDatapath)

function DataStudio() {
  const EX = EXAMPLES
  const first = EX[DATA_LESSON.initial]
  const [example, setExample] = useState(DATA_LESSON.initial)
  const [code, setCode] = useState(first.code)
  const [registers, setRegisters] = useState(first.registers)
  const [memory, setMemory] = useState(first.memory)
  const [input, setInput] = useState({ code: first.code, registers: first.registers, memory: first.memory })
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  const [chart, setChart] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [menu, setMenu] = useState<'sections' | 'examples' | null>(null)
  const [drawer, setDrawer] = useState<Drawer | null>(null)
  const [inspect, setInspect] = useState<Unit | null>(null)
  const [allChecks, setAllChecks] = useState(false)
  const [mode, setMode] = usePref<ViewMode>('st-mode', 'focus')
  const [camera, setCamera] = usePref<'follow' | 'whole'>('st-camera', 'follow')
  const [values, setValues] = usePref('pl-values', true)
  const [detail, setDetail] = usePref('pl-detail', false)
  const [vpEl, setVpEl] = useState<HTMLDivElement | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null)
  const drawerRef = useRef<HTMLElement>(null)

  const sim = useMemo(() => run(input, false, {}), [input])
  const steps = useMemo(() => buildSteps(sim, mode), [sim, mode])
  const step: Step = steps[Math.min(stepIndex, steps.length - 1)]
  const c = sim.cycles[step.cycle]
  const prev = step.cycle > 0 ? sim.cycles[step.cycle - 1] : null
  const ex = explain(sim, step)
  const whole = mode === 'whole'
  const last = steps.length - 1
  const w = useMemo(() => wholeCycle(sim, step.cycle), [sim, step.cycle])
  const current = example >= 0 ? EX[example] : null
  const dirty = input.code !== code || input.registers !== registers || input.memory !== memory

  // ---------- navigation ----------
  const go = (k: number) => { setStepIndex(Math.max(0, Math.min(last, k))); setStarted(true) }
  const seekCycle = (k: number) => go(Math.max(0, steps.findIndex((s) => s.cycle === k)))
  const nextCycle = () => { const k = steps.findIndex((s) => s.cycle === step.cycle + 1); go(k < 0 ? last : k) }
  const prevCycle = () => seekCycle(step.phase === 'edge' || whole ? Math.max(0, step.cycle - 1) : step.cycle)
  const switchMode = (m: ViewMode) => {
    if (m === mode) return
    setMode(m)
    setStepIndex(Math.max(0, buildSteps(sim, m).findIndex((s) => s.cycle === step.cycle)))
  }
  const reset = () => { setStepIndex(0); setError(''); setStarted(false); setChart(false); setInspect(null) }
  const choose = (k: number) => {
    const e = EX[k]
    setExample(k); setCode(e.code); setRegisters(e.registers); setMemory(e.memory)
    setInput({ code: e.code, registers: e.registers, memory: e.memory }); reset(); setMenu(null)
  }
  const load = () => {
    try {
      run({ code, registers, memory }, false, {})
      setInput({ code, registers, memory }); reset(); setExample(-1); setDrawer(null)
    } catch (e) { setError((e as Error).message) }
  }
  const closeInspect = useCallback(() => {
    setInspect((u) => {
      if (u) requestAnimationFrame(() => frameEl?.querySelector<SVGElement>(`[data-unit="${u}"]`)?.focus())
      return null
    })
  }, [frameEl])
  const onInspect = useCallback((u: Unit) => setInspect((cur) => (cur === u ? null : u)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape') {
        if (menu) setMenu(null)
        else if (inspect) closeInspect()
        else if (drawer) setDrawer(null)
        return
      }
      if (t.closest('textarea, select, input:not([type=checkbox])')) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (!started) { setStarted(true); return }
        if (e.shiftKey) nextCycle(); else go(stepIndex + 1)
      }
      if (e.key === 'ArrowLeft' && started) { e.preventDefault(); if (e.shiftKey) prevCycle(); else go(stepIndex - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => { if (drawer) drawerRef.current?.querySelector<HTMLElement>('.st-drawer-close')?.focus() }, [drawer])

  // ---------- camera ----------
  // The frame takes the shape of what the camera shows, so a close-up fills the stage's height.
  const size = useSize(vpEl)
  const sheet = useMemo(() => sheetBox({}, false), [])
  const region = !whole && camera === 'follow' ? cameraRegion(c, step.phase, ex.lines) : null
  const [rx, ry, rw, rh] = region ? [region.x, region.y, region.w, region.h] : [0, 0, 0, 0]
  const target = useMemo(() => (rw ? pad({ x: rx, y: ry, w: rw, h: rh }, 0.05, sheet) : sheet), [rx, ry, rw, rh, sheet])
  const view = useCamera(target, frameEl)
  const frame = contain(view.w / view.h, size)
  const scale = frame.w ? frame.w / view.w : 0
  /** Sheet coordinates → pixels inside the frame. */
  const toScreen = (x: number, y: number) => [(x - view.x) * scale, (y - view.y) * scale] as const
  const zoom = contain(target.w / target.h, size).w / target.w / (contain(sheet.w / sheet.h, size).w / sheet.w)

  // ---------- pins ----------
  const numbered = useMemo(() => numberLines(ex.lines), [ex])
  const wholeRows = useMemo(() => {
    const order: Stage[] = ['WB', 'MEM', 'EX', 'ID', 'IF']
    let n = 0
    return order.map((st) => {
      const card = w.cards.find((x) => x.stage === st)!
      const at = cardPin(card)
      const label = at ? card.badges.find((b) => b.tone && b.tone !== 'muted')?.text : undefined
      return { card, at, num: at ? ++n : null, label }
    })
  }, [w])
  const pins: Pin[] = !started || chart ? [] : whole ? wholeRows.flatMap((r) => (r.at && r.num ? [{ at: r.at, num: r.num, label: r.label }] : [])) : numbered.pins

  // ---------- legend: meanings visible in the current view ----------
  const [inView, setInView] = useState<string[]>([])
  useEffect(() => {
    const svg = frameEl?.querySelector('svg')
    if (!svg || !started) return
    const found = new Set<string>()
    svg.querySelectorAll<SVGGElement>('g[data-look]').forEach((g) => {
      const look = g.dataset.look!
      if (look === 'hidden' || Number(g.getAttribute('opacity') ?? 1) < 0.5) return
      const b = g.getBBox()
      if (b.x > target.x + target.w || b.x + b.width < target.x || b.y > target.y + target.h || b.y + b.height < target.y) return
      found.add(look === 'normal' || look === 'chosen' ? (g.dataset.kind === 'ctrl' ? 'ctrl' : 'data') : look)
    })
    setInView(LEGEND.map((x) => x.key).filter((k) => found.has(k)))
  }, [target, stepIndex, mode, values, sim, started, chart, frameEl])

  // ---------- clock bar ----------
  const events = useMemo(() => sim.cycles.map((x, k) => {
    const p = sim.cycles[k - 1]
    if (x.hazard.stall && !x.hazard.overridden) return { tone: 'hazard', why: 'load-use hazard detected, stall' }
    if (p?.hazard.stall && !p.hazard.overridden) return { tone: 'hazard', why: 'PC and IF/ID held, bubble enters EX' }
    const e = real(x.at.idex)
    const f = e && x.ex ? [x.ex.fa, x.ex.fb].filter((y) => y.sel !== '00' && !(y.unused && e.instr.op !== 'sw')) : []
    if (f.length) return { tone: f.some((y) => y.sel === '10') ? 'ex' : 'mem', why: f.map((y) => `${y.field === 'Rs' ? 'ForwardA' : 'ForwardB'} = ${y.sel}`).join(', ') }
    return null
  }), [sim])
  const scrubRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const ol = scrubRef.current
    const on = ol?.querySelector<HTMLElement>('.now')
    if (ol && on && ol.scrollWidth > ol.clientWidth) ol.scrollTo({ left: on.offsetLeft - ol.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' })
  }, [step.cycle, started])
  const cycleSteps = steps.filter((s) => s.cycle === step.cycle)
  const kInCycle = cycleSteps.findIndex((s) => s.phase === step.phase)

  const scrubber = <ol ref={scrubRef} className="st-scrub" aria-label="Jump to a cycle">
    {sim.cycles.map((x, k) => {
      const e = events[k]
      const label = `Cycle ${x.n}${e ? `: ${e.why}` : ''}`
      const state = !started ? '' : k === step.cycle ? 'now' : k < step.cycle ? 'past' : 'future'
      return <li key={x.n}><button className={state} aria-label={label} title={label} aria-current={state === 'now' ? 'step' : undefined} onClick={() => seekCycle(k)}>
        <span>{x.n}</span><i className={e ? e.tone : ''} />
      </button></li>
    })}
  </ol>

  // ---------- inspect card position ----------
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(0)
  useLayoutEffect(() => { setCardH(cardRef.current?.offsetHeight ?? 0) }, [inspect, step, view])
  let cardPos: { left: number; top: number } | null = null
  if (inspect && size.w) {
    const b = unitBox(inspect)
    const [fx0, fy0] = toScreen(b.x, b.y), [fx1] = toScreen(b.x + b.w, b.y)
    const x0 = fx0 + frame.left, x1 = fx1 + frame.left, y0 = fy0 + frame.top
    const CW = Math.min(360, size.w - 24)
    const left = x1 + 16 + CW <= size.w - 12 ? x1 + 16 : x0 - 16 - CW >= 12 ? x0 - 16 - CW : Math.max(12, size.w - CW - 12)
    const top = Math.min(Math.max(12, y0), Math.max(12, size.h - cardH - 12))
    cardPos = { left, top }
  }

  const deps = dependences(sim)
  const merged = deps.filter((d, k) => !deps.slice(0, k).some((e) => e.consumer === d.consumer && e.producer === d.producer && e.reg === d.reg))
  const stallAt = (consumer: number) => sim.cycles.find((x) => x.hazard.stall && x.at.ifid && !x.at.ifid.squashed && x.at.ifid.instr.id === consumer)?.n
  const showPlan = !started || chart
  const n = sim.program.length
  const nextTitle = step.cycle + 1 < sim.cycles.length ? wholeCycle(sim, step.cycle + 1).title : null
  const hasHidden = !whole && ex.lines.some((l) => l.checks && !positive(l))
  const toneTag = ex.tone === 'forward' ? (ex.lines.some((l) => l.tone === 'ex') ? ['ex', 'EX/MEM forward'] : ['mem', 'MEM/WB forward'])
    : ex.tone === 'hazard' ? ['hazard', 'stall'] : ex.tone === 'rf' ? ['rf', 'register file'] : null
  const focus = whole ? null : FOCUS[step.phase]
  const packets: Record<Stage, { instr: Instr; bubble?: boolean; squashed?: Squash } | null> = {
    IF: c.fetch.instr ? { instr: c.fetch.instr } : null, ID: c.at.ifid, EX: c.at.idex, MEM: c.at.exmem, WB: c.at.memwb,
  }

  return <div className="studio">
    {/* ---------- top bar ---------- */}
    <header className="st-top">
      <div className="st-top-left">
        <a className="st-brand" href="#/"><span aria-hidden="true"><i /><i /><i /></span>CSE 209 Lab</a>
        <div className="st-menu-wrap">
          <button className="st-pill st-section" aria-haspopup="true" aria-expanded={menu === 'sections'} onClick={() => setMenu(menu === 'sections' ? null : 'sections')}>
            <span className="muted">Pipelining ›</span> <b>Data hazards</b> <span aria-hidden="true">▾</span>
          </button>
          <Popover open={menu === 'sections'} onClose={() => setMenu(null)} className="st-sections">
            <nav aria-label="All pages">{NAV_GROUPS.map((g) => <div key={g}>
              <h3>{g}</h3>
              <ul>{NAV.filter((p) => p.group === g).map((p) => <li key={p.path}>
                <a href={`#/${p.path}`} aria-current={p.path === 'data-hazards' ? 'page' : undefined} onClick={() => setMenu(null)}>{p.title}</a>
              </li>)}</ul>
            </div>)}</nav>
          </Popover>
        </div>
      </div>
      <div className="st-menu-wrap">
        <button className="st-pill st-example" aria-haspopup="dialog" aria-expanded={menu === 'examples'} onClick={() => setMenu(menu === 'examples' ? null : 'examples')}>
          <span className="muted">Example</span><b>{current ? current.name.replace(/\s*\(slides? [^)]*\)$/, '') : 'Your own program'}</b>{current && <span className="muted">{current.from}</span>}<span aria-hidden="true">▾</span>
        </button>
        <Popover open={menu === 'examples'} onClose={() => setMenu(null)} className="st-examples">
          <div role="dialog" aria-label="Choose an example">
            {[...new Set(EX.map((e) => e.group))].map((g) => <div key={g}>
              <h3>{g}</h3>
              {EX.map((x, k) => x.group === g && <button key={x.name} className={k === example ? 'on' : ''} onClick={() => choose(k)}>{x.name}<small>{x.from}</small></button>)}
            </div>)}
          </div>
        </Popover>
      </div>
      <div className="st-top-actions">
        <button className="st-pill" aria-pressed={showPlan} disabled={!started} onClick={() => setChart(!chart)} title={started ? 'Show the timing chart with the current cycle marked' : 'The timing chart is showing; start clocking for the datapath'}>Timing chart</button>
        {(['latches', 'state', 'rules', 'edit'] as Drawer[]).map((d) => <button key={d} className="st-pill" aria-pressed={drawer === d} onClick={() => setDrawer(drawer === d ? null : d)}>{d === 'edit' ? '✎ Edit code' : DRAWER_TITLE[d]}</button>)}
      </div>
    </header>

    <div className="st-main">
      {/* ---------- stage ---------- */}
      <section className="st-stage" aria-label={showPlan ? 'The plan' : 'Datapath'}>
        {showPlan ? <>
          <p className="st-hint">{started ? 'The whole run, with the current cycle marked. Click a cycle number to jump there.' : 'Before you start, the stage shows the whole run. It turns into the datapath when you start clocking.'}</p>
          <div className="st-plan">
            <p className="st-plan-total"><b>{sim.cycles.length} cycles</b> <span>= 5 + ({n} − 1){sim.stalls ? <> + <b className="hz">{sim.stalls} stall{sim.stalls === 1 ? '' : 's'}</b></> : null}</span></p>
            <PlanChart sim={sim} now={started ? step.cycle + 1 : null} onSeek={(k) => { seekCycle(k); setChart(false) }} />
          </div>
        </> : <>
          <div className="st-stage-head">
            <ol className="st-occupancy" aria-label="Who is in each stage">
              {STAGES.map((st) => {
                const p = packets[st]
                const on = focus?.includes(st)
                return <li key={st} className={focus ? (on ? 'on' : 'off') : ''}>
                  <b>{st}</b>{packetChip(p)}
                  {on && p && !p.bubble && !p.squashed && <code>{p.instr.text}</code>}
                </li>
              })}
            </ol>
            <div className="st-stage-tools">
              <div className="st-seg" role="radiogroup" aria-label="Camera">
                <button role="radio" aria-checked={camera === 'follow' && !whole} onClick={() => { setCamera('follow'); switchMode('focus') }} title={whole ? 'Read this cycle in steps, with the camera zooming to each step' : 'Zoom to the part of the datapath the step is about'}>Follow the step</button>
                <button role="radio" aria-checked={camera === 'whole' || whole} onClick={() => setCamera('whole')}>Whole datapath</button>
              </div>
              <button className="st-pill" aria-pressed={values} onClick={() => setValues(!values)} title="Show the values on the wires">Values</button>
            </div>
          </div>
          <div className="st-viewport" ref={setVpEl}>
            <div className="st-frame" ref={setFrameEl} style={{ width: frame.w, height: frame.h, left: frame.left, top: frame.top }}>
              <Diagram cycle={c} phase={step.phase} spotlight values={values} hw={sim.hw} studio view={target} onInspect={onInspect} selected={inspect} />
              {scale > 0 && pins.map((p) => {
                const [px, py] = unitPin(p.at)
                if (px < view.x || px > view.x + view.w || py < view.y || py > view.y + view.h) return null
                const [sx, sy] = toScreen(px, py)
                const x = Math.min(Math.max(sx, 16), frame.w - 16), y = Math.min(Math.max(sy, 16), frame.h - 16) // keep the whole pin in the frame
                const label = p.label && p.label.length <= 26 ? p.label : undefined
                return <div key={p.num} className={`st-pin ${x > frame.w - 190 ? 'flip' : ''}`} style={{ left: x, top: y }} aria-hidden="true"><b>{p.num}</b>{label && <span>{label}</span>}</div>
              })}
              <span className="st-camera-chip">{!whole && camera === 'follow' && region
                ? <><b>Camera:</b> {CAMERA_NAME[step.phase]} · {zoom.toFixed(1)}×</>
                : 'Click a pipeline register, a unit or the register file to inspect it'}</span>
            </div>
            {inspect && cardPos && <div ref={cardRef} className="st-inspect" role="dialog" aria-label={unitName(inspect)} style={cardPos}>
              <header><h3>{unitName(inspect)}</h3><button aria-label="Close" onClick={closeInspect}>✕</button></header>
              <InspectBody u={inspect} c={c} step={step} sim={sim} onAll={(d) => { setDrawer(d); closeInspect() }} />
            </div>}
          </div>
        </>}
        <div className="st-stage-foot">
          {!showPlan ? <div className="st-legend" aria-label="Colours in view">
            <span className="st-legend-title">In view</span>
            {LEGEND.filter((x) => inView.includes(x.key)).map((x) => <span key={x.key}><i style={{ background: x.color }} />{x.label}</span>)}
          </div> : <span />}
          <div className="st-clock" role="toolbar" aria-label="Clock">
            {started
              ? <span className="st-clock-now"><b>Cycle {c.n}</b> <span className="muted">· {whole ? 'whole cycle' : `step ${kInCycle + 1} of ${cycleSteps.length}`}</span></span>
              : <span className="st-clock-now muted">Jump to a cycle</span>}
            {scrubber}
            {started ? <>
              <button className="st-pill" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0} title={whole ? 'Previous cycle (←)' : 'Previous step (←)'}>◀ Back</button>
              <button className="st-primary" onClick={() => go(stepIndex + 1)} disabled={stepIndex === last} title={whole ? 'Next cycle (→)' : 'Next step (→)'}>{whole ? 'Next cycle ▶' : 'Next ▶'}</button>
            </> : <button className="st-primary big" onClick={() => { setStepIndex(0); setStarted(true) }}>Start clocking ▶</button>}
          </div>
        </div>
      </section>

      {/* ---------- script ---------- */}
      <section className="st-script" aria-label={started ? 'What happens' : 'About this example'}>
        {!started ? <>
          <div className="st-script-head">
            <p className="st-eyebrow">{DATA_LESSON.crumb}</p>
            <h1>{DATA_LESSON.title}</h1>
          </div>
          <div className="st-script-body">
            <div className="st-goal">
              <span>What this example shows</span>
              <p>{current ? <><b>{current.name}.</b> {current.goal}</> : <><b>Your own program.</b> Same hardware: slide 75's forwarding unit and hazard detection unit.</>}</p>
            </div>
            <h2>The program</h2>
            <ol className="st-program">{sim.program.map((i) => <li key={i.id}><Chip i={i} /><code>{i.text}</code></li>)}</ol>
            <h2>Hazards to watch for</h2>
            {merged.length ? <ul className="st-hazards">{merged.map((d) => {
              const r = d.resolution
              const s = d.stalls ? stallAt(d.consumer) : undefined
              return <li key={`${d.consumer}-${d.producer}-${d.reg}`}>
                <Chip i={sim.program[d.consumer]} /> needs <b><code>{regName(d.reg)}</code></b> from <Chip i={sim.program[d.producer]} />
                {d.stalls ? <span className="pl-tag hazard">{s ? `stall in cycle ${s}` : `${d.stalls} stall${d.stalls > 1 ? 's' : ''}`}</span> : null}
                {r.kind === 'exmem' ? <span className="pl-tag ex">10 in cycle {r.cycle}</span>
                  : r.kind === 'memwb' ? <span className="pl-tag mem">01 in cycle {r.cycle}</span>
                    : r.kind === 'regfile-same' ? <span className="pl-tag rf">register file, cycle {r.cycle}</span>
                      : <span className="pl-tag muted">already written</span>}
                {r.kind !== 'regfile' && r.kind !== 'regfile-same' && r.double ? <span className="pl-tag ex">double data hazard</span> : null}
              </li>
            })}</ul> : <p className="muted">No instruction reads a register written by an earlier instruction here, so there is nothing to forward.</p>}
          </div>
          <p className="st-script-foot">→ start clocking · Shift + arrow = whole cycle</p>
        </> : <>
          <div className="st-script-head">
            <p className="st-eyebrow">Cycle {c.n} of {sim.cycles.length}</p>
            <h2 aria-live="polite">{w.title}</h2>
            <div className="st-seg small" role="radiogroup" aria-label="Read the cycle">
              <button role="radio" aria-checked={whole} onClick={() => switchMode('whole')}>Whole cycle</button>
              <button role="radio" aria-checked={!whole} onClick={() => switchMode('focus')}>In steps</button>
            </div>
          </div>
          <div className="st-script-body">
            {whole ? <>
              <ol className="st-items">{wholeRows.map(({ card, num }) => <li key={card.stage} className={`st-item ${num === null ? 'nopin' : ''}`}>
                <span className={`st-num ${num === null ? 'dot' : ''}`} aria-hidden="true">{num ?? '·'}</span>
                <div className="st-item-body">
                  {num !== null && <span className="sr-only">Pin {num}: </span>}
                  <span className="st-stage-line"><b>{card.stage}</b>{card.instr ? <Chip i={card.instr} bubble={card.bubble} gone={card.gone} /> : <Chip i={null} />}
                    {card.instr && !card.bubble && <code>{card.gone ? `${card.gone.why === 'flush' ? 'flushed' : 'discarded'}: ${card.instr.text}` : card.instr.text}</code>}</span>
                  <span className="st-when">{card.when}</span>
                  {card.badges.length > 0 && <span className="st-badges">{card.badges.map((b, i) => <span key={i} className={`pl-tag ${TAG[b.tone ?? 'muted'] ?? 'muted'}`}>{b.text}</span>)}</span>}
                  {detail && card.lines.length > 0 && <ol className="st-detail">{card.lines.map((l, k) => <li key={k} className={`st-line ${l.tone ?? ''}`}><Md text={l.text} /><Checks line={l} all /></li>)}</ol>}
                </div>
              </li>)}</ol>
              {detail && <details className="st-edge">
                <summary>What latched at the ↑ edge that started this cycle</summary>
                <ol className="st-detail">{w.edge.map((l, k) => <li key={k} className={`st-line ${l.tone ?? ''}`}><Md text={l.text} /></li>)}</ol>
              </details>}
              <button className="st-soft" aria-expanded={detail} onClick={() => setDetail(!detail)}>{detail ? 'Hide details ▴' : 'Show details ▾'}</button>
            </> : <>
              {cycleSteps.slice(0, kInCycle).map((s) => <button key={s.phase} className="st-done" onClick={() => go(steps.indexOf(s))}>
                <b>{PHASES.find((p) => p.phase === s.phase)!.short}</b><span>{explain(sim, s).title}</span>
              </button>)}
              <article className="st-card">
                <header><b>{PHASES.find((p) => p.phase === step.phase)!.short}</b>{toneTag && <span className={`pl-tag ${toneTag[0]}`}>{toneTag[1]}</span>}</header>
                <p className="st-card-title">{ex.title}</p>
                <ol className="st-items">{numbered.items.map((it, k) => <ItemView key={k} item={it} all={allChecks} />)}</ol>
                {hasHidden && <button className="st-quiet" aria-expanded={allChecks} onClick={() => setAllChecks(!allChecks)}>{allChecks ? 'Fewer condition checks ▴' : 'Every condition check ▾'}</button>}
              </article>
              {cycleSteps.slice(kInCycle + 1).map((s) => <button key={s.phase} className="st-done later" onClick={() => go(steps.indexOf(s))}>
                <b>{PHASES.find((p) => p.phase === s.phase)!.short}</b><span>{explain(sim, s).title}</span>
              </button>)}
            </>}
            {nextTitle && <div className="st-teaser"><span>Next · cycle {c.n + 1}</span><b>{nextTitle}</b></div>}
          </div>
          <p className="st-script-foot">{whole ? '→ next cycle · ← back' : '→ next step · ← back · Shift + arrow = whole cycle'}</p>
        </>}

        {drawer && <aside className="st-drawer" ref={drawerRef} role="dialog" aria-label={DRAWER_TITLE[drawer]}>
          <header><h2>{DRAWER_TITLE[drawer]}</h2><button className="st-drawer-close" aria-label="Close" onClick={() => setDrawer(null)}>✕</button></header>
          <div className="st-drawer-body">
            {drawer === 'latches' && <>
              <p className="muted">“Next edge” is what each register latches at the end of this cycle. Highlighted rows changed at the last edge.</p>
              <div className="pl-latches">
                {(['pc', 'ifid', 'idex', 'exmem', 'memwb'] as const).map((k) => <Latch key={k} title={k === 'pc' ? 'PC' : { ifid: 'IF/ID', idex: 'ID/EX', exmem: 'EX/MEM', memwb: 'MEM/WB' }[k]} k={k} c={c} prev={prev} edge={step.phase === 'edge' || step.phase === 'all'} hw={sim.hw} />)}
              </div>
            </>}
            {drawer === 'state' && <>
              <div className="pl-head"><h2>The program</h2><span className="muted">Addresses and machine code</span></div>
              <ProgramTable sim={sim} />
              <RegisterFile c={c} phase={step.phase} />
              <DataMemory c={c} sim={sim} />
            </>}
            {drawer === 'rules' && <DataRules />}
            {drawer === 'edit' && <div className="st-editor">
              <label htmlFor="st-code">MIPS code <span className="muted">(add, sub, and, or, slt, nor, addi, lw, sw, nop)</span></label>
              <textarea id="st-code" rows={Math.max(5, code.split('\n').length + 1)} spellCheck={false} value={code} onChange={(x) => setCode(x.target.value)} />
              <label htmlFor="st-regs">Initial registers</label>
              <textarea id="st-regs" rows={2} spellCheck={false} value={registers} onChange={(x) => setRegisters(x.target.value)} />
              <label htmlFor="st-mem">Initial memory <span className="muted">(byte address = value)</span></label>
              <textarea id="st-mem" rows={2} spellCheck={false} value={memory} onChange={(x) => setMemory(x.target.value)} />
              <div className="st-editor-go">
                <button className="st-primary" onClick={load}>Load program &amp; reset</button>
                {dirty && <span className="pl-dirty">Not loaded yet.</span>}
              </div>
              {error && <p className="err" role="alert">{error} The previous program is still loaded.</p>}
            </div>}
          </div>
        </aside>}
      </section>
    </div>
  </div>
}
