import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PipelineDatapath } from '../pipeline/PipelineDatapath'
import { instrColor, tint } from '../pipeline/colors'
import { EXAMPLES } from '../pipeline/examples'
import { buildSteps, controlText, explain, PHASES, type Line, type Step } from '../pipeline/explain'
import { dependences, destination, hex, NAMES, parseInitial, parseProgram, regName, simulate, type Controls, type Cycle, type Instr, type Latches, type Simulation } from '../pipeline/engine'
import './pipeline.css'

/** Renders the explanation markup: `code` and **bold**. */
function Md({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return <>{parts.map((p, i) => p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>)}</>
}

function Chip({ i, bubble }: { i: Instr | null | undefined; bubble?: boolean }) {
  if (!i) return <span className="pl-chip empty">empty</span>
  if (bubble) return <span className="pl-chip bubble">bubble</span>
  return <span className="pl-chip" style={{ background: instrColor(i) }}>I{i.id + 1}</span>
}

// ---------- program overview ----------

function Overview({ sim }: { sim: Simulation }) {
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
  return <section className="pl-overview">
    <div>
      <h2>The program</h2>
      <table className="pl-program">
        <thead><tr><th></th><th>Instruction</th><th>Address</th><th>Machine code</th><th>Writes</th></tr></thead>
        <tbody>{sim.program.map((i) => <tr key={i.id}>
          <td><Chip i={i} /></td><td><code>{i.text}</code></td><td>{i.id * 4}</td><td className="mono">{hex(i.word)}</td>
          <td>{i.op === 'sw' ? <span className="muted">memory</span> : destination(i) ? regName(destination(i)) : <span className="muted">nothing ($zero)</span>}</td>
        </tr>)}</tbody>
      </table>
      <p className="pl-total"><b>{5} + ({n} − 1) + {sim.stalls} stall{sim.stalls === 1 ? '' : 's'} = {sim.cycles.length} cycles</b> <span className="muted">(5 stages for the first instruction, 1 more per instruction, plus stalls)</span></p>
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
  </section>
}

// ---------- pipeline register contents ----------

type Row = [string, string]
const ctrl3 = (c: Controls, op?: Instr['op']) => {
  const t = controlText(c, op)
  const get = (k: string) => t.match(new RegExp(`${k}=(\\w+)`))![1]
  return {
    WB: `RegWrite=${get('RegWrite')} MemtoReg=${get('MemtoReg')}`,
    M: `MemRead=${get('MemRead')} MemWrite=${get('MemWrite')}`,
    EX: `RegDst=${get('RegDst')} ALUOp=${get('ALUOp')} ALUSrc=${get('ALUSrc')}`,
  }
}
function fields(l: Latches, key: 'pc' | 'ifid' | 'idex' | 'exmem' | 'memwb'): Row[] {
  if (key === 'pc') return [['PC', `${l.pc}`]]
  if (key === 'ifid') return l.ifid ? [['Instruction', `${hex(l.ifid.instr.word)}  ${l.ifid.instr.text}`], ['PC + 4', `${l.ifid.pc4}`]] : []
  if (key === 'idex') {
    const p = l.idex
    if (!p) return []
    const c = ctrl3(p.ctrl, p.bubble ? undefined : p.instr.op)
    return [['WB', c.WB], ['M', c.M], ['EX', c.EX], ['PC + 4', `${p.pc4}`], ['Read data 1', `${p.data1}`], ['Read data 2', `${p.data2}`], ['Sign-extended imm', `${p.imm}`], ['RegisterRs', regName(p.rs)], ['RegisterRt', regName(p.rt)], ['RegisterRd', regName(p.rd)]]
  }
  if (key === 'exmem') {
    const p = l.exmem
    if (!p) return []
    const c = ctrl3(p.ctrl, p.bubble ? undefined : p.instr.op)
    return [['WB', c.WB], ['M', c.M], ['ALU result', `${p.aluResult}`], ['Write data', `${p.writeData}`], ['RegisterRd', regName(p.regRd)]]
  }
  const p = l.memwb
  if (!p) return []
  const c = ctrl3(p.ctrl, p.bubble ? undefined : p.instr.op)
  return [['WB', c.WB], ['Read data', `${p.readData}`], ['ALU result', `${p.aluResult}`], ['RegisterRd', regName(p.regRd)]]
}

function Latch({ title, k, c, prev, edge }: { title: string; k: 'pc' | 'ifid' | 'idex' | 'exmem' | 'memwb'; c: Cycle; prev: Cycle | null; edge: boolean }) {
  const now = fields(c.at, k), next = fields(c.next, k), before = prev ? fields(prev.at, k) : []
  const pkt = k === 'pc' ? null : c.at[k]
  const held = (k === 'pc' || k === 'ifid') && c.hazard.stall
  const wasHeld = (k === 'pc' || k === 'ifid') && !!prev?.hazard.stall
  const color = pkt && !('bubble' in pkt && pkt.bubble) ? instrColor(pkt.instr) : '#868e96'
  const names = [...new Set([...now, ...next].map((r) => r[0]))]
  return <article className={`pl-latch ${pkt && 'bubble' in pkt && pkt.bubble ? 'bubble' : ''} ${held ? 'held' : ''}`} style={{ borderTopColor: k === 'pc' ? '#343a40' : color }}>
    <header>
      <h3>{title}</h3>
      {k !== 'pc' && <Chip i={pkt?.instr} bubble={!!pkt && 'bubble' in pkt && pkt.bubble} />}
      {held && <span className="pl-tag hazard">write disabled: holds next edge</span>}
      {edge && wasHeld && <span className="pl-tag hazard">held at this edge</span>}
    </header>
    <p className="pl-latch-who">{pkt ? ('bubble' in pkt && pkt.bubble ? `bubble (fields left over from ${pkt.instr.text})` : pkt.instr.text) : k === 'pc' ? 'program counter' : 'empty'}</p>
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

type Cell = { stage: string; repeat?: boolean }
function TimingChart({ sim, cycle, onSeek }: { sim: Simulation; cycle: number; onSeek: (k: number) => void }) {
  const rows: { key: string; label: string; instr?: Instr; bubble?: boolean }[] = []
  const bubbleRows = new Map<number, number>() // stalled instruction id → bubble count
  const cells = new Map<string, Map<number, Cell>>()
  const put = (row: string, n: number, cell: Cell) => { if (!cells.has(row)) cells.set(row, new Map()); cells.get(row)!.set(n, cell) }
  sim.cycles.forEach((c, k) => {
    const prev = sim.cycles[k - 1]
    if (c.fetch.instr) put(`i${c.fetch.instr.id}`, c.n, { stage: 'IF', repeat: prev?.fetch.instr?.id === c.fetch.instr.id })
    if (c.at.ifid) put(`i${c.at.ifid.instr.id}`, c.n, { stage: 'ID', repeat: prev?.at.ifid?.instr.id === c.at.ifid.instr.id })
    const st = [['EX', c.at.idex, 0], ['MEM', c.at.exmem, 1], ['WB', c.at.memwb, 2]] as const
    for (const [stage, p, off] of st) {
      if (!p) continue
      if (p.bubble) {
        const key = `b${c.n - off}`
        if (off === 0) bubbleRows.set(p.instr.id, (bubbleRows.get(p.instr.id) ?? 0) + 1)
        put(key, c.n, { stage })
        if (off === 0) rows.push({ key, label: 'bubble', bubble: true, instr: p.instr })
      } else put(`i${p.instr.id}`, c.n, { stage })
    }
  })
  const ordered: typeof rows = []
  for (const i of sim.program) {
    ordered.push(...rows.filter((r) => r.instr?.id === i.id))
    ordered.push({ key: `i${i.id}`, label: i.text, instr: i })
  }
  const LW = 210, CW = 62, RH = 36, TOP = 30
  const N = sim.cycles.length
  const rowOf = (key: string) => ordered.findIndex((r) => r.key === key)
  const x = (n: number) => LW + (n - 1) * CW
  const y = (r: number) => TOP + r * RH
  const now = cycle + 1
  // forwarding arrows (only those that matter)
  const arrows: { x1: number; y1: number; x2: number; y2: number; kind: 'ex' | 'mem' | 'rf' }[] = []
  for (const c of sim.cycles) {
    const e = c.at.idex
    if (e && !e.bubble && c.ex) {
      for (const f of [c.ex.fa, c.ex.fb]) {
        if (f.sel === '00' || (f.unused && e.instr.op !== 'sw')) continue
        const src = f.sel === '10' ? c.at.exmem! : c.at.memwb!
        const r1 = rowOf(`i${src.instr.id}`), r2 = rowOf(`i${e.instr.id}`)
        const dx = f.field === 'Rs' ? 0 : 8
        arrows.push({ x1: x(c.n) + 8 + dx, y1: y(r1) + RH - 6, x2: x(c.n) + 26 + dx, y2: y(r2) + 6, kind: f.sel === '10' ? 'ex' : 'mem' })
      }
    }
    if (c.id && c.wb?.writes && (c.id.sameCycleRs || c.id.sameCycleRt)) {
      const r1 = rowOf(`i${c.at.memwb!.instr.id}`), r2 = rowOf(`i${c.id.instr.id}`)
      arrows.push({ x1: x(c.n) + CW * 0.3, y1: y(r1) + RH - 6, x2: x(c.n) + CW * 0.7, y2: y(r2) + 6, kind: 'rf' })
    }
  }
  const color = { ex: '#e8590c', mem: '#7048e8', rf: '#0c8599' }
  const W = LW + N * CW + 10, H = TOP + ordered.length * RH + 8
  return <div className="pl-chart-scroll">
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Multi-cycle pipeline diagram">
      <defs>
        <pattern id="tc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff5f5" /><line x1="0" y1="0" x2="0" y2="6" stroke="#ffc9c9" strokeWidth="3" /></pattern>
        {Object.entries(color).map(([k, v]) => <marker key={k} id={`tc-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={v} /></marker>)}
      </defs>
      <rect x={x(now)} y={4} width={CW} height={H - 6} rx={6} fill="#fff4e6" stroke="#f59f00" strokeWidth={1.5} />
      {sim.cycles.map((c) => <text key={c.n} x={x(c.n) + CW / 2} y={20} textAnchor="middle" fontSize={13} fontWeight={c.n === now ? 700 : 400} fill={c.n === now ? '#d9480f' : '#6a665c'}>CC{c.n}</text>)}
      {ordered.map((r, k) => <g key={r.key}>
        {r.bubble
          ? <text x={10} y={y(k) + RH / 2 + 5} fontSize={13} fill="#868e96" fontStyle="italic">bubble (stall)</text>
          : <><circle cx={18} cy={y(k) + RH / 2} r={9} fill={instrColor(r.instr!)} /><text x={18} y={y(k) + RH / 2 + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="white">{r.instr!.id + 1}</text>
            <text x={34} y={y(k) + RH / 2 + 5} fontSize={14} fontFamily="Consolas, monospace" fill="#1d1b16">{r.label}</text></>}
        {[...(cells.get(r.key) ?? new Map<number, Cell>()).entries()].map(([n, cell]) => {
          const future = n > now
          const fill = r.bubble ? '#fff' : cell.repeat ? 'url(#tc-hatch)' : tint(instrColor(r.instr!), '26')
          return <g key={n} opacity={future ? 0.35 : 1}>
            <rect x={x(n) + 3} y={y(k) + 4} width={CW - 6} height={RH - 8} rx={6} fill={fill} stroke={r.bubble ? '#adb5bd' : cell.repeat ? '#e03131' : instrColor(r.instr!)} strokeDasharray={r.bubble ? '4 3' : undefined} strokeWidth={1.3} />
            <text x={x(n) + CW / 2} y={y(k) + RH / 2 + 5} textAnchor="middle" fontSize={13} fontWeight={r.bubble ? 400 : 600} fill={r.bubble ? '#868e96' : cell.repeat ? '#c92a2a' : '#1d1b16'}>{r.bubble ? 'nop' : cell.stage}</text>
          </g>
        })}
      </g>)}
      {arrows.map((a, k) => {
        const future = a.x1 > x(now) + CW
        return <line key={k} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={color[a.kind]} strokeWidth={2.4} strokeDasharray={a.kind === 'rf' ? '5 4' : undefined} markerEnd={`url(#tc-${a.kind})`} opacity={future ? 0.25 : 1} />
      })}
      {sim.cycles.map((c) => <rect key={c.n} className="pl-chart-col" x={x(c.n)} y={0} width={CW} height={H} fill="transparent" onClick={() => onSeek(c.n - 1)}><title>{`Go to cycle ${c.n}`}</title></rect>)}
    </svg>
  </div>
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

export function PipelineLab() {
  const [example, setExample] = useState(9)
  const [code, setCode] = useState(EXAMPLES[9].code)
  const [registers, setRegisters] = useState(EXAMPLES[9].registers)
  const [memory, setMemory] = useState(EXAMPLES[9].memory)
  const [input, setInput] = useState({ code: EXAMPLES[9].code, registers: EXAMPLES[9].registers, memory: EXAMPLES[9].memory })
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState('')
  const [spotlight, setSpotlight] = useState(true)
  const [values, setValues] = useState(true)

  const sim = useMemo(() => { const init = parseInitial(input.registers, input.memory); return simulate(parseProgram(input.code), init.regs, init.memory) }, [input])
  const steps = useMemo(() => buildSteps(sim), [sim])
  const step: Step = steps[Math.min(stepIndex, steps.length - 1)]
  const c = sim.cycles[step.cycle]
  const prev = step.cycle > 0 ? sim.cycles[step.cycle - 1] : null
  const ex = explain(sim, step)
  const last = steps.length - 1
  const dirty = input.code !== code || input.registers !== registers || input.memory !== memory

  const go = (k: number) => setStepIndex(Math.max(0, Math.min(last, k)))
  const seekCycle = (k: number) => go(steps.findIndex((s) => s.cycle === k))
  const nextCycle = () => { const k = steps.findIndex((s) => s.cycle === step.cycle + 1); go(k < 0 ? last : k) }
  const prevCycle = () => seekCycle(step.phase === 'edge' ? Math.max(0, step.cycle - 1) : step.cycle)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('textarea, select, input:not([type=checkbox])')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) nextCycle(); else go(stepIndex + 1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) prevCycle(); else go(stepIndex - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const choose = (k: number) => {
    const e = EXAMPLES[k]
    setExample(k); setCode(e.code); setRegisters(e.registers); setMemory(e.memory)
    setInput({ code: e.code, registers: e.registers, memory: e.memory }); setStepIndex(0); setError('')
  }
  const load = () => {
    try {
      const init = parseInitial(registers, memory)
      simulate(parseProgram(code), init.regs, init.memory)
      setInput({ code, registers, memory }); setStepIndex(0); setError(''); setExample(-1)
    } catch (e) { setError((e as Error).message) }
  }

  const phasesHere = steps.filter((s) => s.cycle === step.cycle)
  const memAddrs = [...new Set([...Object.keys(c.memory), ...Object.keys(sim.final.memory)].map(Number))].sort((a, b) => a - b)
  const groups = [...new Set(EXAMPLES.map((e) => e.group))]
  const regsShown = step.phase === 'edge' ? c.regs : c.regsMid
  const wbReg = c.wb?.writes && step.phase !== 'edge' ? c.wb.rd : -1

  const signal = (name: string, v: ReactNode, on: boolean, tone = '') => <div className={`pl-sig ${on ? 'on' : ''} ${tone}`}><span>{name}</span><b>{v}</b></div>
  const e = c.at.idex && !c.at.idex.bubble ? c.ex : null

  return <main className="page pipeline-lab">
    <header className="page-head">
      <p className="crumb">Chapter 4 Part 2 · slides 52–75 · pipelined datapath with forwarding and hazard detection</p>
      <h1>Pipeline lab: forwarding, hazard detection and stalls</h1>
      <p className="lede">Pick a case, read what hazards it has, then clock the processor yourself. Each clock cycle is split into four steps so you can see exactly what changes: the clock edge, the register write in the first half, the read and hazard check in the second half, and the forwarding unit, ALU and memory.</p>
    </header>

    <section className="pl-setup">
      <div className="pl-examples">
        {groups.map((g) => <div key={g}>
          <h3 className="preset-group">{g}</h3>
          <div className="scen">{EXAMPLES.map((x, k) => x.group === g && <button key={x.name} className={k === example ? 'on' : ''} onClick={() => choose(k)}>{x.name}<small>{x.from}</small></button>)}</div>
        </div>)}
      </div>
      <div className="pl-editor">
        {example >= 0 ? <p className="pl-goal"><b>{EXAMPLES[example].name}.</b> {EXAMPLES[example].goal}</p> : <p className="pl-goal"><b>Your own program.</b> Same hardware: slide 75's forwarding unit and hazard detection unit.</p>}
        <label htmlFor="pl-code">MIPS code <span className="muted">(add, sub, and, or, slt, nor, addi, lw, sw, nop)</span></label>
        <textarea id="pl-code" rows={Math.max(4, code.split('\n').length + 1)} spellCheck={false} value={code} onChange={(x) => setCode(x.target.value)} />
        <div className="pl-init">
          <div><label htmlFor="pl-regs">Initial registers</label><textarea id="pl-regs" rows={2} spellCheck={false} value={registers} onChange={(x) => setRegisters(x.target.value)} /></div>
          <div><label htmlFor="pl-mem">Initial memory (byte address = value)</label><textarea id="pl-mem" rows={2} spellCheck={false} value={memory} onChange={(x) => setMemory(x.target.value)} /></div>
        </div>
        <button className="lab-primary" onClick={load}>Load program &amp; reset</button>
        {dirty && <span className="pl-dirty">You changed the program: load it to apply.</span>}
        {error && <p className="err" role="alert">{error} The previous program is still loaded.</p>}
      </div>
    </section>

    <Overview sim={sim} />

    <section className="pl-clock" aria-label="Clock">
      <div className="pl-clock-now" aria-live="polite">
        <b>Clock cycle {c.n} <span className="muted">of {sim.cycles.length}</span></b>
        <span className={`pl-clock-title ${ex.tone}`}>{ex.title}</span>
      </div>
      <ol className="pl-phases">
        {PHASES.map((p) => {
          const k = steps.findIndex((s) => s.cycle === step.cycle && s.phase === p.phase)
          const here = phasesHere.some((s) => s.phase === p.phase)
          return <li key={p.phase} className={`${step.phase === p.phase ? 'on' : ''} ${here ? '' : 'skip'}`}>
            <button disabled={!here} onClick={() => go(k)}><b>{p.short}</b><small>{p.long}</small></button>
          </li>
        })}
      </ol>
      <div className="pl-buttons">
        <button onClick={() => go(0)} disabled={stepIndex === 0} title="Back to cycle 1">⏮ Reset</button>
        <button onClick={prevCycle} disabled={stepIndex === 0} title="Shift + ←">⏪ Cycle</button>
        <button onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0} title="←">◀ Back</button>
        <button className="lab-primary" onClick={() => go(stepIndex + 1)} disabled={stepIndex === last} title="→">Next ▶</button>
        <button onClick={nextCycle} disabled={stepIndex === last} title="Shift + →">Cycle ⏩</button>
        <button onClick={() => go(last)} disabled={stepIndex === last}>End ⏭</button>
      </div>
      <input className="pl-scrub" aria-label="Step" type="range" min={0} max={last} value={stepIndex} onChange={(x) => go(Number(x.target.value))} />
    </section>

    <div className="pl-stage">
      <div className="pl-diagram"><PipelineDatapath cycle={c} phase={step.phase} spotlight={spotlight} values={values} /></div>
      <aside className={`pl-explain ${ex.tone}`}>
        <h2>{ex.title}</h2>
        <ol>{ex.lines.map((l, k) => <LineView key={k} line={l} />)}</ol>
        <div className="pl-sigs">
          {signal('PCWrite', c.hazard.checked || c.at.ifid ? c.pcWrite : 1, c.hazard.stall, 'hazard')}
          {signal('IF/IDWrite', c.ifidWrite, c.hazard.stall, 'hazard')}
          {signal('Stall', +c.hazard.stall, c.hazard.stall, 'hazard')}
          {signal('ForwardA', e ? e.fa.sel : '—', !!e && e.fa.sel !== '00', e?.fa.sel === '10' ? 'ex' : 'mem')}
          {signal('ForwardB', e ? e.fb.sel : '—', !!e && e.fb.sel !== '00' && !e.fb.unused, e?.fb.sel === '10' ? 'ex' : 'mem')}
          {signal('RegWrite (WB)', c.wb ? c.wb.regWrite : '—', !!c.wb?.writes, 'rf')}
        </div>
      </aside>
    </div>

    <div className="pl-below">
    <div className="pl-toggles">
      <label><input type="checkbox" checked={spotlight} onChange={(x) => setSpotlight(x.target.checked)} /> Spotlight this step</label>
      <label><input type="checkbox" checked={values} onChange={(x) => setValues(x.target.checked)} /> Show values</label>
      <span className="muted">Keys: → next step · ← back · Shift + arrow = whole cycle</span>
    </div>
    <div className="pl-legend">
      <span><i style={{ background: '#e8590c' }} />EX/MEM → ALU (Forward = 10)</span>
      <span><i style={{ background: '#7048e8' }} />MEM/WB → ALU (Forward = 01)</span>
      <span><i style={{ background: '#e03131' }} />hazard detection / stall</span>
      <span><i style={{ background: '#0c8599' }} />register file: write in 1st half, read in 2nd half</span>
      <span><i style={{ background: '#111' }} />data in use</span>
      <span><i style={{ background: '#24519e' }} />control in use</span>
      <span><i style={{ background: '#cdcdcd' }} />not used this cycle</span>
    </div>
    </div>

    <section>
      <div className="pl-head"><h2>Pipeline register contents</h2><span className="muted">“Next edge” is what each register will latch at the end of this cycle. Highlighted rows changed at the last edge.</span></div>
      <div className="pl-latches">
        <Latch title="PC" k="pc" c={c} prev={prev} edge={step.phase === 'edge'} />
        <Latch title="IF/ID" k="ifid" c={c} prev={prev} edge={step.phase === 'edge'} />
        <Latch title="ID/EX" k="idex" c={c} prev={prev} edge={step.phase === 'edge'} />
        <Latch title="EX/MEM" k="exmem" c={c} prev={prev} edge={step.phase === 'edge'} />
        <Latch title="MEM/WB" k="memwb" c={c} prev={prev} edge={step.phase === 'edge'} />
      </div>
    </section>

    <section>
      <div className="pl-head"><h2>Instruction by instruction</h2><span className="muted">Click a cycle to jump there. Red hatched cells repeat because of a stall (slide 74). Arrows show forwarding (orange 10, purple 01) and same-cycle register-file reads (teal dashed).</span></div>
      <TimingChart sim={sim} cycle={step.cycle} onSeek={seekCycle} />
    </section>

    <section className="pl-state">
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
    </section>

    <section className="eqs pl-rules">
      <div>
        <h3>Forwarding unit (EX) · slides 61 and 64</h3>
        <pre>{`EX hazard:
if (EX/MEM.RegWrite and (EX/MEM.RegisterRd ≠ 0)
    and (EX/MEM.RegisterRd = ID/EX.RegisterRs))  ForwardA = 10
if (EX/MEM.RegWrite and (EX/MEM.RegisterRd ≠ 0)
    and (EX/MEM.RegisterRd = ID/EX.RegisterRt))  ForwardB = 10

MEM hazard (revised for the double data hazard):
if (MEM/WB.RegWrite and (MEM/WB.RegisterRd ≠ 0)
    and not (EX/MEM.RegWrite and (EX/MEM.RegisterRd ≠ 0)
             and (EX/MEM.RegisterRd = ID/EX.RegisterRs))
    and (MEM/WB.RegisterRd = ID/EX.RegisterRs))  ForwardA = 01
(same for Rt → ForwardB = 01)`}</pre>
      </div>
      <div>
        <h3>Hazard detection unit (ID) · slide 69</h3>
        <pre>{`if (ID/EX.MemRead and
    ((ID/EX.RegisterRt = IF/ID.RegisterRs) or
     (ID/EX.RegisterRt = IF/ID.RegisterRt)))
  stall the pipeline`}</pre>
        <h3>How it stalls · slide 72</h3>
        <ul className="plain-steps">
          <li>Force the control values in ID/EX to 0: EX, MEM and WB do nothing (the bubble).</li>
          <li>PCWrite = 0 and IF/IDWrite = 0: the using instruction is decoded again, the next one is fetched again.</li>
          <li>One cycle later the loaded value is in MEM/WB and is forwarded with Forward = 01.</li>
        </ul>
      </div>
    </section>
  </main>
}
