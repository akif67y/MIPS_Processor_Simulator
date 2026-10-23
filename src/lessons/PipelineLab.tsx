import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PipelineDatapath } from '../pipeline/PipelineDatapath'
import { instrColor, tint } from '../pipeline/colors'
import { EXAMPLES, type Example } from '../pipeline/examples'
import { BRANCH_EXAMPLES } from '../pipeline/branchExamples'
import { buildSteps, controlText, explain, phasesFor, wholeCycle, type Line, type Phase, type Stage, type StageCard, type Step, type ViewMode } from '../pipeline/explain'
import {
  branchRuns, dependences, destination, hex, isBranch, NAMES, parseInitial, parseProgram, real, regName, simulate,
  type BranchAt, type Controls, type Cycle, type Hardware, type Instr, type Latches, type Policy, type Simulation, type Squash,
} from '../pipeline/engine'
import './pipeline.css'

/** Renders the explanation markup: `code` and **bold**. */
function Md({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return <>{parts.map((p, i) => p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>)}</>
}

function Chip({ i, bubble, gone }: { i: Instr | null | undefined; bubble?: boolean; gone?: Squash }) {
  if (gone) return <span className="pl-chip gone" title={`${gone.why === 'flush' ? 'flushed' : 'discarded'}: ${gone.instr.text}`}>✕ I{gone.instr.id + 1}</span>
  if (!i) return <span className="pl-chip empty">empty</span>
  if (bubble) return <span className="pl-chip bubble">bubble</span>
  return <span className="pl-chip" style={{ background: instrColor(i) }}>I{i.id + 1}</span>
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

// ---------- lessons ----------

type Lesson = {
  crumb: string
  title: string
  examples: (Example & { hw?: Hardware })[]
  initial: number
  /** Branch hardware: labels, beq/bne, the hardware selector and the Branch step. */
  branches: boolean
}

const DATA_LESSON: Lesson = {
  crumb: 'Chapter 4 Part 2 · slides 52–75',
  title: 'Data hazards: forwarding, hazard detection and stalls',
  examples: EXAMPLES,
  initial: 9,
  branches: false,
}
const CONTROL_LESSON: Lesson = {
  crumb: 'Chapter 4 Part 2 · slides 25–31 and 77–81',
  title: 'Control hazards: branches, flushes and branch stalls',
  examples: BRANCH_EXAMPLES,
  initial: 0,
  branches: true,
}

export const DataHazardLab = () => <PipelineLab lesson={DATA_LESSON} />
export const ControlHazardLab = () => <PipelineLab lesson={CONTROL_LESSON} />

const WHERE: Record<BranchAt, { label: string; slide: string; text: string }> = {
  mem: { label: 'MEM', slide: 'slide 77 · Fig. 4.51', text: 'The ALU compares (Zero) and an adder in EX computes the target; PCSrc = Branch AND Zero in MEM.' },
  id: { label: 'ID', slide: 'slide 78 · Fig. 4.62', text: 'A register comparator and the target adder sit in ID, with EX/MEM forwarding into the comparator.' },
}
const POLICY: Record<Policy, { label: string; slide: string; text: string }> = {
  predict: { label: 'Predict not taken', slide: 'slides 28–29', text: 'Keep fetching in order. Flush only if the branch turns out taken.' },
  stall: { label: 'Stall on branch', slide: 'slides 26–27', text: 'Throw away every fetch until the branch is decided, taken or not.' },
  delayed: { label: 'Delayed branch', slide: 'slide 31', text: 'The instruction after the branch (delay slot) always runs. Needs the decision in ID.' },
}
const penalty = (hw: Hardware, taken: boolean) => (hw.policy === 'delayed' ? 0 : hw.policy === 'stall' || taken ? (hw.branch === 'mem' ? 3 : 1) : 0)

// ---------- program overview (shown before clocking starts) ----------

function ProgramTable({ sim }: { sim: Simulation }) {
  const branches = !!sim.hw.branch
  return <table className="pl-program">
    <thead><tr><th></th>{branches && <th>Label</th>}<th>Instruction</th><th>Address</th><th>Machine code</th><th>{branches ? 'Effect' : 'Writes'}</th></tr></thead>
    <tbody>{sim.program.map((i) => <tr key={i.id} className={i.filler ? 'filler' : ''}>
      <td><Chip i={i} /></td>
      {branches && <td className="mono">{i.labels?.map((l) => `${l}:`).join(' ')}</td>}
      <td><code>{i.text}</code>{i.filler && <span className="muted"> (empty word)</span>}</td><td>{i.addr}</td><td className="mono">{hex(i.word)}</td>
      <td>{isBranch(i.op) ? <>branch to {i.target} <span className="muted">(PC + 4 {i.imm < 0 ? '−' : '+'} {Math.abs(i.imm)} × 4)</span></> : i.op === 'sw' ? <span className="muted">memory</span> : destination(i) ? regName(destination(i)) : <span className="muted">nothing ($zero)</span>}</td>
    </tr>)}</tbody>
  </table>
}

function Overview({ sim, goal, onStart }: { sim: Simulation; goal: ReactNode; onStart: () => void }) {
  const deps = dependences(sim)
  const merged = deps.filter((d, k) => !deps.slice(0, k).some((e) => e.consumer === d.consumer && e.producer === d.producer && e.reg === d.reg))
  const stallCycles = sim.cycles.filter((c) => c.hazard.stall)
  const n = sim.program.length
  const how = (d: (typeof deps)[number]) => {
    const both = deps.filter((e) => e.consumer === d.consumer && e.producer === d.producer && e.reg === d.reg).length > 1
    const role = both ? 'rs and rt' : d.role
    const r = d.resolution
    const via = r.kind === 'exmem' ? <span className="pl-tag ex">EX/MEM → EX (Forward = 10) in cycle {r.cycle}</span>
      : r.kind === 'memwb' ? <span className="pl-tag mem">MEM/WB → EX (Forward = 01) in cycle {r.cycle}</span>
      : r.kind === 'regfile-same' ? <span className="pl-tag rf">register file: written 1st half, read 2nd half of cycle {r.cycle}</span>
      : <span className="pl-tag muted">register file (already written)</span>
    return <li key={`${d.consumer}-${d.producer}-${d.reg}`}>
      <Chip i={sim.program[d.consumer]} /> needs <b>{regName(d.reg)}</b> ({role}) from <Chip i={sim.program[d.producer]} />, {d.distance} instruction{d.distance > 1 ? 's' : ''} earlier
      {d.stalls ? <> · <span className="pl-tag hazard">{d.stalls} stall{d.stalls > 1 ? 's' : ''} first</span></> : null} · {via}
      {r.kind !== 'regfile' && r.kind !== 'regfile-same' && r.double ? <> · <span className="pl-tag ex">double data hazard</span></> : null}
    </li>
  }
  return <section className="pl-overview" aria-label="Program overview">
    <p className="pl-goal">{goal}</p>
    <div className="pl-overview-grid">
      <div>
        <h2>The program</h2>
        <ProgramTable sim={sim} />
        <p className="pl-total"><b>5 + ({n} − 1) + {sim.stalls} stall{sim.stalls === 1 ? '' : 's'} = {sim.cycles.length} cycles</b> <span className="muted">(5 stages for the first instruction, 1 more per instruction, plus stalls)</span></p>
      </div>
      <div>
        <h2>Hazards in this program</h2>
        {merged.length ? <ul className="pl-deps">{merged.map(how)}</ul> : <p className="muted">No instruction reads a register written by an earlier instruction here, so there is nothing to forward.</p>}
        {stallCycles.length > 0 && <>
          <h3>Stalls</h3>
          <ul className="pl-deps">{stallCycles.map((c) => <li key={c.n}>
            <span className="pl-tag hazard">cycle {c.n}</span> <Chip i={c.at.ifid!.instr} /> waits in ID: <Chip i={c.at.idex!.instr} /> is a load into {regName(c.hazard.idexRt)} (slide 69)
            {c.hazard.conservative ? <span className="muted"> — not a real dependence: rt is only the destination, but the unit compares numbers.</span> : null}
          </li>)}</ul>
        </>}
      </div>
    </div>
    <StartBar onStart={onStart} branches={false} />
  </section>
}

function StartBar({ onStart, branches }: { onStart: () => void; branches: boolean }) {
  return <div className="pl-start">
    <button className="lab-primary big" onClick={onStart}>Start clocking ▶</button>
    <span className="muted">Each clock cycle is split into steps: ↑ clock edge → 1st half (register write) → 2nd half (register read, hazard check, fetch) → EX + MEM (forwarding, ALU, memory){branches ? ' → Branch (decision, next PC, flush), only in cycles where a branch is decided' : ''}.</span>
  </div>
}

/** Why the hazard detection unit stalled in this cycle, in a few words. */
function stallCause(c: Cycle): string {
  const b = c.hazard.branch
  if (b?.stall && !c.hazard.loadUse) return b.loadRs || b.loadRt ? `a load in MEM is still reading ${regName(b.exmemRd)} (slides 80–81)` : `the ALU result ${regName(b.idexDest)} is still being computed in EX (slide 80)`
  if (b?.stall) return `the load in EX writes ${regName(c.hazard.idexRt)}: first of two stalls (slide 81)`
  return `${c.at.idex!.instr.text} is a load into ${regName(c.hazard.idexRt)} (slide 69)`
}

const ALL_HW: Hardware[] = [
  { branch: 'mem', policy: 'stall' }, { branch: 'mem', policy: 'predict' },
  { branch: 'id', policy: 'stall' }, { branch: 'id', policy: 'predict' }, { branch: 'id', policy: 'delayed' },
]

function BranchOverview({ sim, goal, onStart, others, onPick }: { sim: Simulation; goal: ReactNode; onStart: () => void; others: { hw: Hardware; cycles: number | string }[]; onPick: (hw: Hardware) => void }) {
  const runs = branchRuns(sim)
  const hw = sim.hw
  const n = sim.completed
  const dataStalls = sim.cycles.filter((c) => c.hazard.stall && !c.hazard.overridden)
  const taken = runs.filter((r) => r.taken).length
  return <section className="pl-overview" aria-label="Program overview">
    <p className="pl-goal">{goal}</p>
    <div className="pl-overview-grid">
      <div>
        <h2>The program</h2>
        <ProgramTable sim={sim} />
        <p className="pl-total">
          <b>5 + ({n} − 1) + {sim.stalls} stall{sim.stalls === 1 ? '' : 's'} + {sim.flushes} thrown away{sim.idle ? ` + ${sim.idle} empty fetch${sim.idle > 1 ? 'es' : ''}` : ''} = {sim.cycles.length} cycles</b>
          <br /><span className="muted">{n} instructions really executed (a loop body counts once per iteration). Every slot that is thrown away because of a branch costs one cycle, like a stall.{sim.idle ? ' An empty fetch is a cycle where IF was past the end of the program while a branch was still undecided.' : ''}</span>
        </p>
        <h3>The same program on other hardware</h3>
        <table className="pl-compare">
          <thead><tr><th>Branch decided in</th><th>After a branch</th><th>Cycles</th></tr></thead>
          <tbody>{others.map((o) => {
            const on = o.hw.branch === hw.branch && o.hw.policy === hw.policy
            return <tr key={`${o.hw.branch}-${o.hw.policy}`} className={on ? 'on' : ''}>
              <td>{WHERE[o.hw.branch!].label}</td><td>{POLICY[o.hw.policy!].label}</td>
              <td>{on ? <b>{o.cycles}</b> : <button className="pl-linkish" onClick={() => onPick(o.hw)} title="Switch to this hardware">{o.cycles}</button>}</td>
            </tr>
          })}</tbody>
        </table>
        <p className="muted pl-note">Delayed branch changes what the program does (the delay slot always runs), so compare it only on programs written for it.</p>
      </div>
      <div>
        <h2>Branches in this program</h2>
        <p className="pl-hw-now"><span className="pl-tag branch">decided in {WHERE[hw.branch!].label}</span> <span className="pl-tag muted">{POLICY[hw.policy!].label}</span> {WHERE[hw.branch!].text} {POLICY[hw.policy!].text} Cost per branch: {penalty(hw, true)} cycle{penalty(hw, true) === 1 ? '' : 's'} if taken, {penalty(hw, false)} if not taken{hw.branch === 'id' ? ', plus stalls when a compared register is not ready yet (slides 80–81)' : ''}.</p>
        {runs.length ? <ul className="pl-deps">{runs.map((r) => <li key={r.seq}>
          <Chip i={r.instr} /> <code>{r.instr.text}</code>{runs.filter((x) => x.instr.id === r.instr.id).length > 1 ? <span className="muted"> ({ordinal(r.nth + 1)} time)</span> : null}
          : decided in {hw.branch!.toUpperCase()} in cycle {r.cycle}{hw.branch === 'id' ? <>, {regName(r.instr.rs)} = {r.a}, {regName(r.instr.rt)} = {r.b}</> : null} → <span className={`pl-tag ${r.taken ? 'branch' : 'muted'}`}>{r.taken ? `taken → ${r.target}` : 'not taken'}</span>
          {' '}· {r.lost ? <span className="pl-tag flush">{r.lost} slot{r.lost > 1 ? 's' : ''} thrown away</span> : <span className="pl-tag muted">no cycle lost</span>}
          {r.dataStalls ? <> · <span className="pl-tag hazard">waited {r.dataStalls} stall cycle{r.dataStalls > 1 ? 's' : ''} for its operands</span></> : null}
          {r.forwarded.length ? <> · <span className="pl-tag ex">{r.forwarded.map((f) => regName(f === 'Rs' ? r.instr.rs : r.instr.rt)).join(', ')} forwarded from EX/MEM (slide 79)</span></> : null}
        </li>)}</ul> : <p className="muted">No branch was executed.</p>}
        {runs.length > 0 && <p className="muted pl-note">{taken} of {runs.length} branch{runs.length > 1 ? 'es' : ''} taken.</p>}
        {dataStalls.length > 0 && <>
          <h3>Stalls</h3>
          <ul className="pl-deps">{dataStalls.map((c) => <li key={c.n}>
            <span className="pl-tag hazard">cycle {c.n}</span> <Chip i={c.at.ifid!.instr} /> waits in ID: {stallCause(c)}
          </li>)}</ul>
        </>}
      </div>
    </div>
    <StartBar onStart={onStart} branches />
  </section>
}

// ---------- pipeline register contents ----------

type Row = [string, string]
const ctrl3 = (c: Controls, op: Instr['op'] | undefined, branchInM: boolean) => {
  const t = controlText(c, op, true)
  const get = (k: string) => t.match(new RegExp(`${k}=(\\w+)`))![1]
  return {
    WB: `RegWrite=${get('RegWrite')} MemtoReg=${get('MemtoReg')}`,
    M: `${branchInM ? `Branch=${get('Branch')} ` : ''}MemRead=${get('MemRead')} MemWrite=${get('MemWrite')}`,
    EX: `RegDst=${get('RegDst')} ALUOp=${get('ALUOp')} ALUSrc=${get('ALUSrc')}`,
  }
}
function fields(l: Latches, key: 'pc' | 'ifid' | 'idex' | 'exmem' | 'memwb', hw: Hardware): Row[] {
  const bm = hw.branch === 'mem'
  if (key === 'pc') return [['PC', `${l.pc}`]]
  if (key === 'ifid') return l.ifid ? [['Instruction', `${hex(l.ifid.instr.word)}  ${l.ifid.instr.text}`], ['PC + 4', `${l.ifid.pc4}`]] : []
  if (key === 'idex') {
    const p = l.idex
    if (!p) return []
    const c = ctrl3(p.ctrl, p.bubble ? undefined : p.instr.op, bm)
    return [['WB', c.WB], ['M', c.M], ['EX', c.EX], ...(hw.branch === 'id' ? [] : [['PC + 4', `${p.pc4}`] as Row]), ['Read data 1', `${p.data1}`], ['Read data 2', `${p.data2}`], ['Sign-extended imm', `${p.imm}`], ['RegisterRs', regName(p.rs)], ['RegisterRt', regName(p.rt)], ['RegisterRd', regName(p.rd)]]
  }
  if (key === 'exmem') {
    const p = l.exmem
    if (!p) return []
    const c = ctrl3(p.ctrl, p.bubble ? undefined : p.instr.op, bm)
    return [['WB', c.WB], ['M', c.M], ...(bm ? [['Branch target', `${p.target}`], ['Zero', `${p.zero}`]] as Row[] : []), ['ALU result', `${p.aluResult}`], ['Write data', `${p.writeData}`], ['RegisterRd', regName(p.regRd)]]
  }
  const p = l.memwb
  if (!p) return []
  const c = ctrl3(p.ctrl, p.bubble ? undefined : p.instr.op, bm)
  return [['WB', c.WB], ['Read data', `${p.readData}`], ['ALU result', `${p.aluResult}`], ['RegisterRd', regName(p.regRd)]]
}

function Latch({ title, k, c, prev, edge, hw }: { title: string; k: 'pc' | 'ifid' | 'idex' | 'exmem' | 'memwb'; c: Cycle; prev: Cycle | null; edge: boolean; hw: Hardware }) {
  const now = fields(c.at, k, hw), next = fields(c.next, k, hw), before = prev ? fields(prev.at, k, hw) : []
  const pkt = k === 'pc' ? null : c.at[k]
  const held = (k === 'pc' || k === 'ifid') && c.hazard.stall && !c.hazard.overridden
  const wasHeld = (k === 'pc' || k === 'ifid') && !!prev?.hazard.stall && !prev.hazard.overridden
  const bubble = !!pkt && 'bubble' in pkt && pkt.bubble
  const gone = pkt?.squashed
  const flushNext = c.squash && ((k === 'ifid' && c.squash.ifid) || (k === 'idex' && c.squash.idex) || (k === 'exmem' && c.squash.exmem))
  const color = gone ? '#d6336c' : pkt && !bubble ? instrColor(pkt.instr) : '#868e96'
  const names = [...new Set([...now, ...next].map((r) => r[0]))]
  return <article className={`pl-latch ${bubble ? 'bubble' : ''} ${gone ? 'gone' : ''} ${held ? 'held' : ''}`} style={{ borderTopColor: k === 'pc' ? '#343a40' : color }}>
    <header>
      <h3>{title}</h3>
      {k !== 'pc' && <Chip i={pkt?.instr} bubble={bubble} gone={gone} />}
      {held && <span className="pl-tag hazard">write disabled: holds next edge</span>}
      {edge && wasHeld && <span className="pl-tag hazard">held at this edge</span>}
      {flushNext && <span className="pl-tag flush">{c.squash!.why === 'flush' ? (k === 'ifid' ? 'IF.Flush' : k === 'idex' ? 'ID.Flush' : 'EX.Flush') : 'fetch discarded'} at next edge</span>}
      {k === 'pc' && c.pcSrc ? <span className="pl-tag branch">PCSrc = 1: target next</span> : null}
    </header>
    <p className="pl-latch-who">{pkt ? (gone ? `${gone.why === 'flush' ? 'flushed' : 'discarded'}: was ${gone.instr.text}${bubble ? ' (controls 0)' : ' (now nop)'}` : bubble ? `bubble (fields left over from ${pkt.instr.text})` : pkt.instr.text) : k === 'pc' ? 'program counter' : 'empty'}</p>
    {names.length > 0 && <table>
      <thead><tr><th>Field</th><th>Now</th><th>Next edge</th></tr></thead>
      <tbody>{names.map((name) => {
        const v = now.find((r) => r[0] === name)?.[1] ?? '—'
        const nv = next.find((r) => r[0] === name)?.[1] ?? '—'
        const b = before.find((r) => r[0] === name)?.[1] ?? '—'
        return <tr key={name} className={edge && prev && b !== v ? 'changed' : ''}>
          <th>{name}</th><td>{v}</td><td className={nv !== v ? 'differs' : 'same'}>{nv}</td>
        </tr>
      })}</tbody>
    </table>}
  </article>
}

// ---------- multi-cycle (timing) diagram ----------

/** One row per dynamic instance (seq): a loop body fetched twice gets two rows; a stall bubble gets its own row. */
type Cell = { stage: string; repeat?: boolean; gone?: boolean; kill?: boolean }
type ChartRow = { seq: number; instr: Instr; bubble: boolean; gone?: Squash; cells: Map<number, Cell>; order: number }
function TimingChart({ sim, cycle, onSeek }: { sim: Simulation; cycle: number; onSeek: (k: number) => void }) {
  const rows = new Map<number, ChartRow>()
  const put = (seq: number, instr: Instr, n: number, cell: Cell, bubble = false, gone?: Squash) => {
    if (!rows.has(seq)) rows.set(seq, { seq, instr, bubble, gone, cells: new Map(), order: Infinity })
    const r = rows.get(seq)!
    if (gone) r.gone = gone
    r.cells.set(n, cell)
    if (cell.stage === 'WB') r.order = n
  }
  sim.cycles.forEach((c, k) => {
    const prev = sim.cycles[k - 1]
    if (c.fetch.instr) put(c.fetch.seq, c.fetch.instr, c.n, { stage: 'IF', repeat: c.fetch.repeat, kill: !!c.squash?.ifid })
    if (c.at.ifid) {
      const p = c.at.ifid
      put(p.seq, p.squashed?.instr ?? p.instr, c.n, { stage: 'ID', repeat: prev?.at.ifid?.seq === p.seq, gone: !!p.squashed, kill: !!c.squash?.idex }, false, p.squashed)
    }
    const st = [['EX', c.at.idex, !!c.squash?.exmem], ['MEM', c.at.exmem, false], ['WB', c.at.memwb, false]] as const
    for (const [stage, p, kill] of st) {
      if (!p) continue
      const stallBubble = p.bubble && !p.squashed
      put(p.seq, p.squashed?.instr ?? p.instr, c.n, { stage, gone: !!p.squashed, kill }, stallBubble, p.squashed)
    }
  })
  const ordered = [...rows.values()].sort((a, b) => a.order - b.order || a.seq - b.seq)
  const LW = 250, CW = 62, RH = 36, TOP = 30
  const N = sim.cycles.length
  const rowIndex = new Map(ordered.map((r, k) => [r.seq, k]))
  const x = (n: number) => LW + (n - 1) * CW
  const y = (r: number) => TOP + r * RH
  const now = cycle + 1
  // how many times each static instruction has appeared so far (loops)
  const seen = new Map<number, number>()
  const nth = new Map<number, number>()
  for (const r of ordered) if (!r.bubble) { const k = (seen.get(r.instr.id) ?? 0) + 1; seen.set(r.instr.id, k); nth.set(r.seq, k) }
  // arrows: forwarding (EX), comparator forwarding (ID), same-cycle register file, taken branch → target fetch
  const arrows: { x1: number; y1: number; x2: number; y2: number; kind: 'ex' | 'mem' | 'rf' | 'br' }[] = []
  const rowY = (seq: number) => y(rowIndex.get(seq) ?? 0)
  sim.cycles.forEach((c, k) => {
    const e = real(c.at.idex)
    if (e && c.ex && !(isBranch(e.instr.op) && sim.hw.branch === 'id')) {
      for (const f of [c.ex.fa, c.ex.fb]) {
        if (f.sel === '00' || (f.unused && e.instr.op !== 'sw')) continue
        const src = f.sel === '10' ? c.at.exmem! : c.at.memwb!
        const dx = f.field === 'Rs' ? 0 : 8
        arrows.push({ x1: x(c.n) + 8 + dx, y1: rowY(src.seq) + RH - 6, x2: x(c.n) + 26 + dx, y2: rowY(e.seq) + 6, kind: f.sel === '10' ? 'ex' : 'mem' })
      }
    }
    const b = c.branch
    if (b?.at === 'id') for (const f of [b.fa, b.fb]) {
      if (!f?.sel) continue
      const dx = f.field === 'Rs' ? 0 : 8
      arrows.push({ x1: x(c.n) + 8 + dx, y1: rowY(c.at.exmem!.seq) + RH - 6, x2: x(c.n) + 26 + dx, y2: rowY(b.seq) + 6, kind: 'ex' })
    }
    if (c.id && c.wb?.writes && (c.id.sameCycleRs || c.id.sameCycleRt) && c.at.ifid && !c.at.ifid.squashed) {
      arrows.push({ x1: x(c.n) + CW * 0.3, y1: rowY(c.at.memwb!.seq) + RH - 6, x2: x(c.n) + CW * 0.7, y2: rowY(c.at.ifid.seq) + 6, kind: 'rf' })
    }
    const nextFetch = sim.cycles[k + 1]?.fetch
    if (b?.taken && nextFetch?.instr) arrows.push({ x1: x(c.n) + CW / 2, y1: rowY(b.seq) + RH - 4, x2: x(c.n + 1) + CW / 2, y2: rowY(nextFetch.seq) + 4, kind: 'br' })
  })
  const color = { ex: '#e8590c', mem: '#7048e8', rf: '#0c8599', br: '#2b8a3e' }
  const W = LW + N * CW + 10, H = TOP + ordered.length * RH + 8
  return <div className="pl-chart-scroll">
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Multi-cycle pipeline diagram">
      <defs>
        <pattern id="tc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff5f5" /><line x1="0" y1="0" x2="0" y2="6" stroke="#ffc9c9" strokeWidth="3" /></pattern>
        <pattern id="tc-flush" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#fff0f6" /><line x1="0" y1="0" x2="0" y2="6" stroke="#fcc2d7" strokeWidth="3" /></pattern>
        {Object.entries(color).map(([k, v]) => <marker key={k} id={`tc-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={v} /></marker>)}
      </defs>
      <rect x={x(now)} y={4} width={CW} height={H - 6} rx={6} fill="#fff4e6" stroke="#f59f00" strokeWidth={1.5} />
      {sim.cycles.map((c) => <text key={c.n} x={x(c.n) + CW / 2} y={20} textAnchor="middle" fontSize={13} fontWeight={c.n === now ? 700 : 400} fill={c.n === now ? '#d9480f' : '#6a665c'}>CC{c.n}</text>)}
      {ordered.map((r, k) => {
        const loops = (seen.get(r.instr.id) ?? 0) > 1
        const label = `${r.instr.text}${loops && nth.get(r.seq) ? ` (${nth.get(r.seq)})` : ''}`
        return <g key={r.seq}>
          {r.bubble
            ? <text x={10} y={y(k) + RH / 2 + 5} fontSize={13} fill="#868e96" fontStyle="italic">bubble (stall)</text>
            : <><circle cx={18} cy={y(k) + RH / 2} r={9} fill={r.gone ? '#d6336c' : instrColor(r.instr)} /><text x={18} y={y(k) + RH / 2 + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="white">{r.instr.id + 1}</text>
              <text x={34} y={y(k) + RH / 2 + 5} fontSize={14} fontFamily="Consolas, monospace" fill={r.gone ? '#a61e4d' : '#1d1b16'} textDecoration={r.gone ? 'line-through' : undefined}>{label}</text>
              {r.gone && <text x={LW - 8} y={y(k) + RH / 2 + 5} fontSize={11} textAnchor="end" fill="#d6336c" fontWeight={700}>{r.gone.why === 'flush' ? 'flushed' : 'discarded'}</text>}</>}
          {[...r.cells.entries()].map(([n, cell]) => {
            const future = n > now
            const fill = r.bubble ? '#fff' : cell.gone ? 'url(#tc-flush)' : cell.repeat ? 'url(#tc-hatch)' : tint(instrColor(r.instr), '26')
            const stroke = r.bubble ? '#adb5bd' : cell.gone ? '#d6336c' : cell.repeat ? '#e03131' : instrColor(r.instr)
            return <g key={n} opacity={future ? 0.35 : 1}>
              <rect x={x(n) + 3} y={y(k) + 4} width={CW - 6} height={RH - 8} rx={6} fill={fill} stroke={stroke} strokeDasharray={r.bubble || cell.gone ? '4 3' : undefined} strokeWidth={cell.kill ? 2.6 : 1.3} />
              <text x={x(n) + CW / 2} y={y(k) + RH / 2 + 5} textAnchor="middle" fontSize={13} fontWeight={r.bubble || cell.gone ? 400 : 600} fill={r.bubble ? '#868e96' : cell.gone ? '#a61e4d' : cell.repeat ? '#c92a2a' : '#1d1b16'}>{r.bubble ? 'nop' : cell.stage}</text>
              {cell.kill && <text x={x(n) + CW - 7} y={y(k) + 13} textAnchor="end" fontSize={11} fontWeight={700} fill="#d6336c">✕</text>}
            </g>
          })}
        </g>
      })}
      {arrows.map((a, k) => {
        const future = a.x1 > x(now) + CW
        return <line key={k} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={color[a.kind]} strokeWidth={2.4} strokeDasharray={a.kind === 'rf' ? '5 4' : undefined} markerEnd={`url(#tc-${a.kind})`} opacity={future ? 0.25 : 1} />
      })}
      {sim.cycles.map((c) => <rect key={c.n} className="pl-chart-col" x={x(c.n)} y={0} width={CW} height={H} fill="transparent" onClick={() => onSeek(c.n - 1)}><title>{`Go to cycle ${c.n}`}</title></rect>)}
    </svg>
  </div>
}

// ---------- what happens when inside one clock cycle ----------

/** The real timing of a cycle: every stage works from edge to edge; only the register file is split
 *  (write in the 1st half, read in the 2nd half, slide 55). The part in focus is highlighted. */
function TimingStrip({ c, phase, hw }: { c: Cycle; phase: Phase; hw: Hardware }) {
  const rows: { st: Stage; p: { instr: Instr; bubble?: boolean; squashed?: Squash } | null; what: string; half?: { which: 1 | 2; label: string } }[] = [
    { st: 'IF', p: c.fetch.instr ? { instr: c.fetch.instr } : null, what: 'fetch' },
    { st: 'ID', p: c.at.ifid, what: 'decode · hazard check', half: { which: 2, label: 'reg read' } },
    { st: 'EX', p: c.at.idex, what: 'forwarding · ALU' },
    { st: 'MEM', p: c.at.exmem, what: 'data memory' },
    { st: 'WB', p: c.at.memwb, what: 'WB mux', half: { which: 1, label: 'reg write' } },
  ]
  const brStage: Stage = hw.branch === 'mem' ? 'MEM' : 'ID'
  const focus = (st: Stage, part: 'bar' | 1 | 2): boolean => {
    if (phase === 'all') return true
    if (phase === 'wb') return st === 'WB' && part === 1
    if (phase === 'id') return st === 'IF' || (st === 'ID' && part !== 1)
    if (phase === 'ex') return st === 'EX' || st === 'MEM'
    if (phase === 'br') return st === brStage
    return false
  }
  return <div className={`pl-timing ${phase === 'all' ? 'whole' : ''}`} aria-label="When things happen in this clock cycle">
    <div className="pl-timing-head">
      <span />
      <span className={phase === 'edge' || phase === 'all' ? 'on' : ''}>↑ edge (registers latch) · 1st half</span>
      <span>2nd half · next ↑ edge</span>
    </div>
    {rows.map((r) => {
      const color = !r.p ? '#ced4da' : r.p.squashed ? '#d6336c' : r.p.bubble ? '#868e96' : instrColor(r.p.instr)
      return <div key={r.st} className="pl-timing-row">
        <b>{r.st}</b>
        <div className={`pl-timing-bar ${r.p ? '' : 'empty'}`} style={{ ['--c' as string]: color }}>
          {[1, 2].map((h) => {
            const accent = r.half?.which === h
            const on = focus(r.st, h as 1 | 2)
            return <span key={h} className={`${on ? 'on' : ''} ${accent ? 'accent' : ''}`}>
              {h === 1 && <em>{r.p ? (r.p.squashed ? `✕ ${r.p.squashed.instr.text}` : r.p.bubble ? 'bubble' : r.p.instr.text) : '—'}</em>}
              {accent && <i>{r.half!.label}</i>}
            </span>
          })}
        </div>
      </div>
    })}
    <p className="pl-timing-note muted">{phase === 'all'
      ? 'Every bar runs from edge to edge at the same time. Only the register file has an order: written in the 1st half, read in the 2nd half.'
      : 'Focus steps are a reading order, not a time order: the highlighted part runs at the same time as the grey ones.'}</p>
  </div>
}

const TONE_TAG: Record<string, string> = { ex: 'ex', mem: 'mem', hazard: 'hazard', rf: 'rf', branch: 'branch', flush: 'flush', muted: 'muted' }

function StageCardView({ card, detail }: { card: StageCard; detail: boolean }) {
  const color = card.gone ? '#d6336c' : !card.instr ? '#ced4da' : card.bubble ? '#868e96' : instrColor(card.instr)
  return <section className={`pl-card ${card.instr ? '' : 'empty'}`} style={{ borderTopColor: color }}>
    <header>
      <b>{card.stage}</b>
      {card.instr && <Chip i={card.instr} bubble={card.bubble} gone={card.gone} />}
      <code>{card.instr ? (card.gone ? `${card.gone.why === 'flush' ? 'flushed' : 'discarded'}: ${card.instr.text}` : card.bubble ? 'bubble' : card.instr.text) : 'empty'}</code>
    </header>
    <p className="pl-card-when">{card.when}</p>
    {card.badges.length > 0 && <div className="pl-card-badges">{card.badges.map((b, i) => <span key={i} className={`pl-tag ${TONE_TAG[b.tone ?? 'muted'] ?? 'muted'}`}>{b.text}</span>)}</div>}
    {detail && card.lines.length > 0 && <ol>{card.lines.map((l, k) => <LineView key={k} line={l} />)}</ol>}
  </section>
}

function WholeCycleView({ sim, k, detail, setDetail }: { sim: Simulation; k: number; detail: boolean; setDetail: (v: boolean) => void }) {
  const w = wholeCycle(sim, k)
  const c = sim.cycles[k]
  return <aside className={`pl-explain pl-whole ${w.tone}`} aria-label="What happens in this clock cycle">
    <div className="pl-whole-head">
      <h2>Cycle {c.n}: {w.title}</h2>
      <button aria-pressed={detail} onClick={() => setDetail(!detail)} title="Show the full explanation in every stage card">{detail ? 'Hide details' : 'Show details'}</button>
    </div>
    <TimingStrip c={c} phase="all" hw={sim.hw} />
    <details className="pl-edge-lines">
      <summary>What latched at the ↑ edge that started this cycle</summary>
      <ol>{w.edge.map((l, i) => <LineView key={i} line={l} />)}</ol>
    </details>
    {w.branch && <section className={`pl-card pl-card-branch ${w.branch.tone}`}>
      <header><b>Branch decision</b> <span className="muted">{sim.hw.branch === 'mem' ? 'in MEM' : 'in ID'}, settles by the end of the cycle</span></header>
      <p className="pl-card-when">{w.branch.title}</p>
      {detail && <ol>{w.branch.lines.map((l, i) => <LineView key={i} line={l} />)}</ol>}
    </section>}
    <div className="pl-cards">{w.cards.map((card) => <StageCardView key={card.stage} card={card} detail={detail} />)}</div>
    <p className="pl-keys muted">→ next cycle · ← back · switch to <b>Focus steps</b> to read one part at a time</p>
  </aside>
}

// ---------- page ----------

function LineView({ line }: { line: Line }) {
  return <li className={line.tone ?? ''}>
    <Md text={line.text} />
    {line.checks && <div className="pl-checks">
      {line.checks.map((c, i) => <span key={i} className={c.ok ? 'ok' : 'no'}>{c.ok ? '✔' : '✘'} {c.text}</span>)}
      {line.result && <span className={`res ${line.result === 'false' || line.result === 'no stall' ? 'no' : 'ok'}`}>⇒ {line.result}</span>}
    </div>}
  </li>
}

/** The extra panels below the simulator; the reader switches each one on. */
const PANELS = [
  { id: 'chart', label: 'Timing chart', hint: 'IF-ID-EX-MEM-WB, line by line' },
  { id: 'latches', label: 'Pipeline registers', hint: 'every field, now and next edge' },
  { id: 'state', label: 'Registers & memory', hint: 'register file and data memory' },
  { id: 'rules', label: 'Hardware rules', hint: 'forwarding, hazard and branch conditions' },
] as const
type PanelId = (typeof PANELS)[number]['id']

/** Per-viewer preferences; storage can be missing (private mode), so every access is guarded. */
function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial } catch { return initial }
  })
  const set = (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)) } catch { /* ignore */ } }
  return [v, set]
}

function run(input: { code: string; registers: string; memory: string }, branches: boolean, hw: Hardware) {
  const init = parseInitial(input.registers, input.memory)
  return simulate(parseProgram(input.code, { branches }), init.regs, init.memory, branches ? hw : {})
}

function PipelineLab({ lesson }: { lesson: Lesson }) {
  const EX = lesson.examples
  const first = EX[lesson.initial]
  const [example, setExample] = useState(lesson.initial)
  const [code, setCode] = useState(first.code)
  const [registers, setRegisters] = useState(first.registers)
  const [memory, setMemory] = useState(first.memory)
  const [input, setInput] = useState({ code: first.code, registers: first.registers, memory: first.memory })
  const [hw, setHw] = useState<Hardware>(first.hw ?? {})
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState(false)
  const [editing, setEditing] = useState(false)
  const [intro, setIntro] = useState(true)
  const [spotlight, setSpotlight] = usePref('pl-spotlight', true)
  const [mode, setMode] = usePref<ViewMode>('pl-mode', 'whole')
  const [detail, setDetail] = usePref('pl-detail', false)
  const [values, setValues] = usePref('pl-values', true)
  const [panels, setPanels] = usePref<PanelId[]>('pl-panels', ['chart'])
  const simRef = useRef<HTMLElement>(null)

  const sim = useMemo(() => run(input, lesson.branches, hw), [input, hw, lesson.branches])
  const others = useMemo(() => lesson.branches ? ALL_HW.map((h) => {
    try { return { hw: h, cycles: run(input, true, h).cycles.length as number | string } } catch { return { hw: h, cycles: '—' } }
  }) : [], [input, lesson.branches])
  const steps = useMemo(() => buildSteps(sim, mode), [sim, mode])
  const step: Step = steps[Math.min(stepIndex, steps.length - 1)]
  const c = sim.cycles[step.cycle]
  const prev = step.cycle > 0 ? sim.cycles[step.cycle - 1] : null
  const ex = explain(sim, step)
  const last = steps.length - 1
  const dirty = input.code !== code || input.registers !== registers || input.memory !== memory
  const phases = phasesFor(sim)

  const go = (k: number) => { setStepIndex(Math.max(0, Math.min(last, k))); setIntro(false) }
  const seekCycle = (k: number) => go(steps.findIndex((s) => s.cycle === k))
  const nextCycle = () => { const k = steps.findIndex((s) => s.cycle === step.cycle + 1); go(k < 0 ? last : k) }
  const prevCycle = () => seekCycle(step.phase === 'edge' ? Math.max(0, step.cycle - 1) : step.cycle)
  const start = () => { setIntro(false); requestAnimationFrame(() => simRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape') { setPicker(false); return }
      if (t.closest('textarea, select, input:not([type=checkbox])')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) nextCycle(); else go(stepIndex + 1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) prevCycle(); else go(stepIndex - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const reset = () => { setStepIndex(0); setError(''); setIntro(true) }
  const choose = (k: number) => {
    const e = EX[k]
    setExample(k); setCode(e.code); setRegisters(e.registers); setMemory(e.memory)
    if (e.hw) setHw(e.hw)
    setInput({ code: e.code, registers: e.registers, memory: e.memory }); reset(); setPicker(false); setEditing(false)
  }
  const load = () => {
    try {
      run({ code, registers, memory }, lesson.branches, hw)
      setInput({ code, registers, memory }); reset(); setExample(-1); setEditing(false)
    } catch (e) { setError((e as Error).message) }
  }
  const pickHw = (h: Hardware) => {
    const next = { ...hw, ...h }
    if (next.branch === 'mem' && next.policy === 'delayed') next.policy = 'predict'
    try { run(input, true, next); setHw(next); setStepIndex(0); setError('') } catch (e) { setError((e as Error).message) }
  }
  const togglePanel = (id: PanelId) => setPanels(panels.includes(id) ? panels.filter((p) => p !== id) : [...panels, id])

  const memAddrs = [...new Set([...Object.keys(c.memory), ...Object.keys(sim.final.memory)].map(Number))].sort((a, b) => a - b)
  const groups = [...new Set(EX.map((e) => e.group))]
  const switchMode = (m: ViewMode) => {
    if (m === mode) return
    setMode(m)
    setStepIndex(Math.max(0, buildSteps(sim, m).findIndex((s) => s.cycle === step.cycle)))
  }
  const whole = mode === 'whole'
  const atEdge = step.phase === 'edge' || step.phase === 'all'
  const regsShown = step.phase === 'edge' ? c.regs : c.regsMid
  const wbReg = c.wb?.writes && step.phase !== 'edge' ? c.wb.rd : -1
  const current = example >= 0 ? EX[example] : null
  const forwards = sim.cycles.reduce((n, x) => {
    const e = real(x.at.idex)
    return n + (x.ex && e && !(isBranch(e.instr.op) && hw.branch === 'id') ? [x.ex.fa, x.ex.fb].filter((f) => f.sel !== '00' && !(f.unused && e.instr.op !== 'sw')).length : 0)
      + (x.branch?.at === 'id' ? [x.branch.fa, x.branch.fb].filter((f) => f?.sel === 1).length : 0)
  }, 0)
  const goal = current ? <><b>{current.name}.</b> {current.goal}</> : <><b>Your own program.</b> {lesson.branches ? 'Same hardware as the examples: pick where the branch is decided and what happens after it.' : 'Same hardware: slide 75\'s forwarding unit and hazard detection unit.'}</>

  return <main className="page pipeline-lab">
    <header className="pl-hero">
      <p className="crumb">{lesson.crumb}</p>
      <h1>{lesson.title}</h1>
    </header>

    {/* ---------- what is loaded ---------- */}
    <section className="pl-bar" aria-label="Program">
      <div className="pl-picker">
        <button className="pl-pick" aria-expanded={picker} onClick={() => setPicker(!picker)}>
          <small>{current ? `${current.group} · ${current.from}` : 'Custom program'}</small>
          <b>{current ? current.name : 'Your own program'}</b>
          <span className="pl-caret" aria-hidden>▾</span>
        </button>
        {picker && <>
          <div className="pl-backdrop" onClick={() => setPicker(false)} />
          <div className="pl-menu" role="dialog" aria-label="Choose an example">
            {groups.map((g) => <div key={g}>
              <h3>{g}</h3>
              {EX.map((x, k) => x.group === g && <button key={x.name} className={k === example ? 'on' : ''} onClick={() => choose(k)}>{x.name}<small>{x.from}</small></button>)}
            </div>)}
          </div>
        </>}
      </div>
      <ol className="pl-listing" aria-label="Instructions">
        {sim.program.filter((i) => !i.filler).map((i) => <li key={i.id}><Chip i={i} /><code>{i.labels ? `${i.labels.join(': ')}: ` : ''}{i.text}</code></li>)}
      </ol>
      <div className="pl-bar-actions">
        <button className={`pl-summary ${intro ? 'on' : ''}`} aria-expanded={intro} onClick={() => setIntro(!intro)} title="Program overview and hazards">
          <b>{sim.cycles.length}</b> cycles · <b className={sim.stalls ? 'hz' : ''}>{sim.stalls}</b> stall{sim.stalls === 1 ? '' : 's'} · {lesson.branches && <><b className={sim.flushes ? 'fl' : ''}>{sim.flushes}</b> flushed · </>}<b className={forwards ? 'fw' : ''}>{forwards}</b> forward{forwards === 1 ? '' : 's'} <span aria-hidden>{intro ? '▴' : '▾'}</span>
        </button>
        <button className={editing ? 'on' : ''} aria-expanded={editing} onClick={() => setEditing(!editing)}>✎ Edit code</button>
      </div>
    </section>

    {lesson.branches && <section className="pl-hw" aria-label="Branch hardware">
      <div role="radiogroup" aria-label="Branch decided in">
        <span className="pl-hw-label">Branch decided in</span>
        {(['mem', 'id'] as BranchAt[]).map((b) => <button key={b} role="radio" aria-checked={hw.branch === b} onClick={() => pickHw({ branch: b })}>
          <b>{WHERE[b].label}</b><small>{WHERE[b].slide}</small>
        </button>)}
      </div>
      <div role="radiogroup" aria-label="Instructions after a branch">
        <span className="pl-hw-label">After a branch</span>
        {(['predict', 'stall', 'delayed'] as Policy[]).map((p) => <button key={p} role="radio" aria-checked={hw.policy === p} disabled={p === 'delayed' && hw.branch === 'mem'} onClick={() => pickHw({ policy: p })}
          title={p === 'delayed' && hw.branch === 'mem' ? 'A delayed branch needs the decision in ID (one delay slot).' : POLICY[p].text}>
          <b>{POLICY[p].label}</b><small>{POLICY[p].slide}</small>
        </button>)}
      </div>
    </section>}

    {editing && <section className="pl-editor" aria-label="Edit program">
      <div>
        <label htmlFor="pl-code">MIPS code <span className="muted">({lesson.branches ? 'add, sub, and, or, slt, nor, addi, lw, sw, beq, bne, nop · labels "loop:" · an address in front of a line, e.g. "40: beq $1, $3, 7"' : 'add, sub, and, or, slt, nor, addi, lw, sw, nop'})</span></label>
        <textarea id="pl-code" rows={Math.max(4, code.split('\n').length + 1)} spellCheck={false} value={code} onChange={(x) => setCode(x.target.value)} />
      </div>
      <div className="pl-init">
        <label htmlFor="pl-regs">Initial registers</label>
        <textarea id="pl-regs" rows={2} spellCheck={false} value={registers} onChange={(x) => setRegisters(x.target.value)} />
        <label htmlFor="pl-mem">Initial memory <span className="muted">(byte address = value)</span></label>
        <textarea id="pl-mem" rows={2} spellCheck={false} value={memory} onChange={(x) => setMemory(x.target.value)} />
        <div className="pl-editor-go">
          <button className="lab-primary" onClick={load}>Load program &amp; reset</button>
          {dirty && <span className="pl-dirty">Not loaded yet.</span>}
        </div>
        {error && <p className="err" role="alert">{error} The previous program is still loaded.</p>}
      </div>
    </section>}
    {!editing && error && <p className="err" role="alert">{error}</p>}

    {intro && (lesson.branches
      ? <BranchOverview sim={sim} goal={goal} onStart={start} others={others} onPick={pickHw} />
      : <Overview sim={sim} goal={goal} onStart={start} />)}

    {/* ---------- the simulator ---------- */}
    <section className="pl-sim" ref={simRef} aria-label="Simulator">
      <div className="pl-toolbar" role="toolbar" aria-label="Clock">
        <div className="pl-now" aria-live="polite">
          <b>Cycle {c.n}<span className="muted"> / {sim.cycles.length}</span></b>
          <span className={`pl-now-title ${ex.tone}`}>{ex.title}</span>
        </div>
        <div className="pl-mode" role="radiogroup" aria-label="View">
          <button role="radio" aria-checked={whole} onClick={() => switchMode('whole')} title="One click = one clock cycle; every stage at once, tinted with its instruction">Whole cycle</button>
          <button role="radio" aria-checked={!whole} onClick={() => switchMode('focus')} title="Read one part of the cycle at a time">Focus steps</button>
        </div>
        {!whole && <ol className="pl-phases" aria-label="Focus within this cycle">
          <li className="pl-phases-label" aria-hidden>Focus:</li>
          {phases.map((p) => {
            const k = steps.findIndex((s) => s.cycle === step.cycle && s.phase === p.phase)
            return <li key={p.phase} className={`${step.phase === p.phase ? 'on' : ''} ${k < 0 ? 'skip' : ''}`}>
              <button disabled={k < 0} onClick={() => go(k)} title={p.long}>{p.short}</button>
            </li>
          })}
        </ol>}
        <div className="pl-buttons">
          <button onClick={() => go(0)} disabled={stepIndex === 0} title="Back to cycle 1" aria-label="Reset">⇤</button>
          {!whole && <button onClick={prevCycle} disabled={stepIndex === 0} title="Previous cycle (Shift + ←)" aria-label="Previous cycle">« Cycle</button>}
          <button onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0} title={whole ? 'Previous cycle (←)' : 'Previous step (←)'}>◀ Back</button>
          <button className="lab-primary" onClick={() => go(stepIndex + 1)} disabled={stepIndex === last} title={whole ? 'Next cycle (→)' : 'Next step (→)'}>{whole ? 'Next cycle ▶' : 'Next ▶'}</button>
          {!whole && <button onClick={nextCycle} disabled={stepIndex === last} title="Next cycle (Shift + →)" aria-label="Next cycle">Cycle »</button>}
          <button onClick={() => go(last)} disabled={stepIndex === last} title="Last cycle" aria-label="End">⇥</button>
        </div>
        <div className="pl-view">
          {!whole && <button aria-pressed={spotlight} onClick={() => setSpotlight(!spotlight)} title="Dim everything this step does not use">Spotlight</button>}
          <button aria-pressed={values} onClick={() => setValues(!values)} title="Show the values on the wires">Values</button>
        </div>
        <div className="pl-progress" aria-hidden><i style={{ width: `${(stepIndex / Math.max(1, last)) * 100}%` }} /></div>
      </div>

      <div className="pl-stage">
        <div className="pl-diagram"><PipelineDatapath cycle={c} phase={step.phase} spotlight={spotlight} values={values} hw={sim.hw} /></div>
        {whole ? <WholeCycleView sim={sim} k={step.cycle} detail={detail} setDetail={setDetail} />
          : <aside className={`pl-explain ${ex.tone}`} aria-label="What happens in this step">
            <h2>{ex.title}</h2>
            <TimingStrip c={c} phase={step.phase} hw={sim.hw} />
            <ol>{ex.lines.map((l, k) => <LineView key={k} line={l} />)}</ol>
            <p className="pl-keys muted">→ next step · ← back · Shift + arrow = whole cycle</p>
          </aside>}
      </div>
      <div className="pl-legend">
        <span><i style={{ background: '#e8590c' }} />EX/MEM → ALU (Forward = 10){lesson.branches && hw.branch === 'id' ? ' or → comparator' : ''}</span>
        <span><i style={{ background: '#7048e8' }} />MEM/WB → ALU (Forward = 01)</span>
        <span><i style={{ background: '#e03131' }} />hazard detection / stall</span>
        {lesson.branches && <>
          <span><i style={{ background: '#2b8a3e' }} />branch taken: target → PC</span>
          <span><i style={{ background: '#d6336c' }} />flushed / thrown away</span>
        </>}
        <span><i style={{ background: '#0c8599' }} />register file write / read</span>
        <span><i style={{ background: '#111' }} />data</span>
        <span><i style={{ background: '#24519e' }} />control</span>
        <span><i style={{ background: '#cdcdcd' }} />not used now</span>
      </div>
    </section>

    {/* ---------- optional panels ---------- */}
    <nav className="pl-panel-toggles" aria-label="More panels">
      <span className="muted">Show more:</span>
      {PANELS.map((p) => <button key={p.id} aria-pressed={panels.includes(p.id)} onClick={() => togglePanel(p.id)} title={p.hint}>
        {panels.includes(p.id) ? '✓ ' : '+ '}{p.label}
      </button>)}
    </nav>

    {panels.includes('chart') && <section className="pl-panel">
      <div className="pl-head"><h2>Instruction by instruction</h2><span className="muted">Click a cycle to jump there. Red hatched cells repeat because of a stall.{lesson.branches ? ' Pink dashed cells were flushed (✕ marks the stage where it happened); a green arrow goes from the branch decision to the target fetch.' : ''} Arrows: forwarding (orange 10, purple 01), same-cycle register-file read (teal dashed).</span></div>
      <TimingChart sim={sim} cycle={step.cycle} onSeek={seekCycle} />
    </section>}

    {panels.includes('latches') && <section className="pl-panel">
      <div className="pl-head"><h2>Pipeline register contents</h2><span className="muted">“Next edge” is what each register latches at the end of this cycle. Highlighted rows changed at the last edge.</span></div>
      <div className="pl-latches">
        <Latch title="PC" k="pc" c={c} prev={prev} edge={atEdge} hw={sim.hw} />
        <Latch title="IF/ID" k="ifid" c={c} prev={prev} edge={atEdge} hw={sim.hw} />
        <Latch title="ID/EX" k="idex" c={c} prev={prev} edge={atEdge} hw={sim.hw} />
        <Latch title="EX/MEM" k="exmem" c={c} prev={prev} edge={atEdge} hw={sim.hw} />
        <Latch title="MEM/WB" k="memwb" c={c} prev={prev} edge={atEdge} hw={sim.hw} />
      </div>
    </section>}

    {panels.includes('state') && <section className="pl-panel pl-state">
      <div>
        <div className="pl-head"><h2>Register file</h2><span className="muted">{step.phase === 'edge' ? 'At the start of the cycle.' : 'After the first-half write.'} Hover for hex.</span></div>
        <div className="pl-regs">{NAMES.map((n, r) => <div key={n} className={r === wbReg ? 'written' : ''} title={hex(regsShown[r])}>
          <span>{regName(r)} <small>{regName(r) === `$${n}` ? r : n}</small></span><b>{r === wbReg && c.wb ? <><s>{c.wb.old}</s> {regsShown[r]}</> : regsShown[r]}</b>
        </div>)}</div>
      </div>
      <div>
        <div className="pl-head"><h2>Data memory</h2><span className="muted">A store is written at the end of its MEM cycle.</span></div>
        {memAddrs.length ? <table className="pl-memory"><thead><tr><th>Address</th><th>Value</th></tr></thead>
          <tbody>{memAddrs.map((a) => <tr key={a} className={c.mem?.address === a ? (c.mem.write ? 'writing' : 'reading') : ''}><td>{a}</td><td>{c.memory[a] ?? 0}{c.mem?.address === a && c.mem.write ? ` → ${c.at.exmem!.writeData} at edge` : ''}</td></tr>)}</tbody>
        </table> : <p className="muted">No memory words used.</p>}
      </div>
    </section>}

    {panels.includes('rules') && (lesson.branches ? <BranchRules /> : <DataRules />)}
  </main>
}

const FORWARD_RULES = `EX hazard:
if (EX/MEM.RegWrite and (EX/MEM.RegisterRd ≠ 0)
    and (EX/MEM.RegisterRd = ID/EX.RegisterRs))  ForwardA = 10
if (EX/MEM.RegWrite and (EX/MEM.RegisterRd ≠ 0)
    and (EX/MEM.RegisterRd = ID/EX.RegisterRt))  ForwardB = 10

MEM hazard (revised for the double data hazard):
if (MEM/WB.RegWrite and (MEM/WB.RegisterRd ≠ 0)
    and not (EX/MEM.RegWrite and (EX/MEM.RegisterRd ≠ 0)
             and (EX/MEM.RegisterRd = ID/EX.RegisterRs))
    and (MEM/WB.RegisterRd = ID/EX.RegisterRs))  ForwardA = 01
(same for Rt → ForwardB = 01)`
const LOAD_USE_RULE = `if (ID/EX.MemRead and
    ((ID/EX.RegisterRt = IF/ID.RegisterRs) or
     (ID/EX.RegisterRt = IF/ID.RegisterRt)))
  stall the pipeline`

function DataRules() {
  return <section className="pl-panel eqs pl-rules">
    <div>
      <h3>Forwarding unit (EX) · slides 61 and 64</h3>
      <pre>{FORWARD_RULES}</pre>
    </div>
    <div>
      <h3>Hazard detection unit (ID) · slide 69</h3>
      <pre>{LOAD_USE_RULE}</pre>
      <h3>How it stalls · slide 72</h3>
      <ul className="plain-steps">
        <li>Force the control values in ID/EX to 0: EX, MEM and WB do nothing (the bubble).</li>
        <li>PCWrite = 0 and IF/IDWrite = 0: the using instruction is decoded again, the next one is fetched again.</li>
        <li>One cycle later the loaded value is in MEM/WB and is forwarded with Forward = 01.</li>
      </ul>
    </div>
  </section>
}

function BranchRules() {
  return <section className="pl-panel eqs pl-rules">
    <div>
      <h3>Branch decided in MEM · slide 77, Fig. 4.51</h3>
      <pre>{`EX:  Zero   = (ALU result = 0)        ALUOp = 01: subtract
     target = ID/EX.PC+4 + (imm << 2)
MEM: PCSrc  = EX/MEM.Branch and EX/MEM.Zero
              (bne: Branch and not Zero)
if (PCSrc) PC ← EX/MEM.target, and the 3 younger
  instructions are flushed:
  IF.Flush (IF/ID ← 0 = nop), ID.Flush, EX.Flush
  (their control values are set to 0)`}</pre>
      <p className="muted">A flush wins over a load-use stall in the same cycle: the stalled instructions are on the wrong path.</p>
    </div>
    <div>
      <h3>Branch decided in ID · slide 78, Fig. 4.62</h3>
      <pre>{`target = IF/ID.PC+4 + (imm << 2)        (adder in ID)
Equal  = (comparator input 1 = input 2)
PCSrc  = Branch and Equal   (bne: not Equal)
if (PCSrc) PC ← target, IF.Flush (IF/ID ← nop)

Comparator forwarding (slide 79):
if (EX/MEM.RegWrite and (EX/MEM.RegisterRd ≠ 0)
    and (EX/MEM.RegisterRd = IF/ID.RegisterRs))  ForwardC = 1
(same for Rt → ForwardD = 1)
A value in WB needs no path: written in the 1st half,
read in the 2nd half.`}</pre>
    </div>
    <div>
      <h3>Hazard detection for branches · slides 80–81</h3>
      <pre>{`if (IF/ID is a branch and
    ((ID/EX.RegWrite and ID/EX.dest ≠ 0 and
      ID/EX.dest = IF/ID.RegisterRs or IF/ID.RegisterRt)
  or (EX/MEM.MemRead and EX/MEM.RegisterRd ≠ 0 and
      EX/MEM.RegisterRd = IF/ID.RegisterRs or IF/ID.RegisterRt)))
  stall the pipeline   (same stall as slide 72)
ID/EX.dest = RegDst ? Rd : Rt`}</pre>
      <ul className="plain-steps">
        <li>ALU instruction 2 or 3 before the branch: no stall (forward from EX/MEM, or register file).</li>
        <li>ALU instruction right before, or lw 2 before: 1 stall.</li>
        <li>lw right before: 2 stalls.</li>
      </ul>
    </div>
    <div>
      <h3>What happens after a branch · slides 26–31</h3>
      <ul className="plain-steps">
        <li><b>Stall on branch</b> (26–27): every fetch is thrown away until the branch is decided. Cost: 3 cycles (MEM) or 1 (ID), taken or not.</li>
        <li><b>Predict not taken</b> (28–29): keep fetching in order. Cost only when taken: 3 cycles (MEM) or 1 (ID).</li>
        <li><b>Delayed branch</b> (31): the instruction after the branch always runs. No hardware flush; the compiler fills the slot.</li>
      </ul>
      <h3>Load-use hazard · slide 69</h3>
      <pre>{LOAD_USE_RULE}</pre>
      <h3>Forwarding unit (EX) · slides 61 and 64</h3>
      <pre>{FORWARD_RULES}</pre>
    </div>
  </section>
}
