import { useMemo, useState } from 'react'
import { PipelineDatapath } from '../pipeline/PipelineDatapath'
import { EXAMPLES } from '../pipeline/examples'
import { dependencies, hex, NAMES, parseInitial, parseProgram, regName, simulate, wbValue, type Frame, type Packet, type Simulation } from '../pipeline/engine'
import './pipeline.css'

const name = (p: Packet | null) => p?.ins ? `I${p.ins.id + 1}: ${p.ins.text}` : p?.bubble ? `Bubble B${p.bubble}` : 'Empty'
const value = (n: number) => `${n} (${hex(n)})`
function packetFields(p: Packet | null, stage: number): [string, string][] {
  if (!p) return [['Valid', '0 — empty']]
  const i = p.ins
  const fields: [string, string][] = [['Valid', i ? '1' : '0 — bubble'], ['PC + 4', hex(p.pc4)]]
  if (stage <= 1) fields.push(['rs / rt / destination', i ? `${regName(i.rs)} / ${regName(i.rt)} / ${regName(i.dest)}` : '—'], ['Immediate (extended)', String(i?.imm ?? 0)])
  if (stage === 1) fields.push(['Read data 1 (latched)', value(p.a)], ['Read data 2 (latched)', value(p.b)])
  if (stage >= 2) fields.push(['ALU result / address', value(p.result)], ['Destination', i ? regName(i.dest) : '—'])
  if (stage === 2) fields.push(['Store data (latched)', value(p.store)], ['Store source rt', i ? regName(i.rt) : '—'])
  if (stage === 3) fields.push(['Memory read data', value(p.loaded)], ['WB mux output', value(wbValue(p))])
  if (stage > 0) {
    if (stage === 1) fields.push(['EX controls', `RegDst=${p.control.RegDst} ALUSrc=${p.control.ALUSrc} ALUOp=${p.control.ALUOp}`], ['ALU control (decoded)', p.control.ALUControl])
    if (stage <= 2) fields.push(['MEM controls', `MemRead=${p.control.MemRead} MemWrite=${p.control.MemWrite}`])
    fields.push(['WB controls', `RegWrite=${p.control.RegWrite} MemtoReg=${p.control.MemtoReg}`])
  }
  return fields
}

function explain({ state: s, signals: g }: Frame, sim: Simulation): string[] {
  const i = s.idex?.ins, d = s.ifid?.ins
  const lines = [s.half === 0
    ? g.wb ? `First half: WB will write ${regName(g.wb.dest)} = ${g.wb.value}. Click “Next half-cycle” to perform this write before ID reads.` : 'First half: no register write is enabled. $zero always remains 0.'
    : g.wb ? `Second half: ${regName(g.wb.dest)} now contains ${g.wb.value}. ID reads the updated register file in this half of the same cycle.` : 'Second half: ID reads the register file. EX and MEM results are ready for the next clock edge.']
  if (d) lines.push(`ID decodes I${d.id + 1}: rs ${regName(d.rs)} = ${g.decodeA}, rt ${regName(d.rt)} = ${g.decodeB}${s.half === 0 ? ' (reads are sampled in the second half)' : ''}. ${d.usesB ? d.op === 'sw' ? 'rt is store data, needed in MEM.' : 'Both source operands are needed in EX.' : 'rt is not an EX source; a matching destination alone cannot cause a stall.'}`)
  if (g.stall) lines.push(`Load-use hazard: ID/EX.MemRead=1 and destination ${regName(i!.dest)} matches IF/ID.${g.matchA && g.matchB ? 'rs and rt' : g.matchA ? 'rs' : 'rt'}. Set PCWrite=0 and IF/IDWrite=0. At the next edge keep PC=${s.pc}, keep ${name(s.ifid)}, and replace ID/EX with a bubble whose EX/MEM/WB controls are all zero. The load and older instructions continue.`)
  else if (s.idex?.bubble) lines.push(`Bubble B${s.idex.bubble} occupies EX with zero controls. The previous load is now reading memory. The held consumer can leave ID at the next edge; then MEM/WB can forward the load value into EX.`)
  if (i) {
    for (const [field, used, sel, r] of [['A', i.usesA, g.a, i.rs], ['B', i.usesB, g.b, i.rt]] as const) {
      if (used) lines.push(sel.pending ? `Store data ${regName(r)} is not ready yet. The newer load in EX/MEM blocks any older value. Carry the store forward; the MEM/WB → memory path will supply the data in its MEM stage.` : `Forward${field}=${sel.select}: ${regName(r)} takes ${sel.value} from ${sel.source}.${sel.priority ? ' Both writers match: EX/MEM is newer, so the older MEM/WB value is rejected.' : ''}`)
    }
    lines.push(`EX computes ${s.idex!.control.ALUControl}(${g.a.value}, ${g.aluB}) = ${g.result}.${s.idex!.control.ALUSrc ? ' ALUSrc selects the extended immediate; ForwardB still feeds the separate store-data path when needed.' : ''}`)
  }
  if (g.memoryRead !== null) lines.push(`MEM reads ${hex(s.exmem!.result)} → ${g.memoryRead}. This value reaches MEM/WB at the next edge; it cannot travel backward in time into this cycle’s EX stage.`)
  if (s.exmem?.control.MemWrite) lines.push(`MEM will write ${g.store} to ${hex(s.exmem.result)} at the next edge, using ${g.storeForward ? 'the late MEM/WB → memory bypass' : 'the store data carried in EX/MEM'}.`)
  if (sim.program[s.pc / 4]) lines.push(`IF fetches I${s.pc / 4 + 1} at ${hex(s.pc)}.${g.stall ? ' The fetch is repeated next cycle because PC and IF/ID are frozen.' : ` At the edge it enters IF/ID and PC advances to ${hex(s.pc + 4)}.`}`)
  return lines
}

function TimingChart({ sim, cursor, onSeek }: { sim: Simulation; cursor: number; onSeek: (index: number) => void }) {
  const cycles = sim.frames.filter(f => f.state.half === 0)
  const rows = [...sim.program.map(i => ({ key: `i${i.id}`, title: `I${i.id + 1} · ${i.text}` })), ...Array.from({ length: sim.stalls }, (_, i) => ({ key: `b${i + 1}`, title: `Bubble B${i + 1} · zero controls` }))]
  const cells = cycles.map(({ state: s, signals: g }) => {
    const map: Record<string, string> = {}
    if (sim.program[s.pc / 4]) map[`i${s.pc / 4}`] = g.stall ? 'IF hold' : 'IF'
    ;[s.ifid, s.idex, s.exmem, s.memwb].forEach((p, index) => {
      if (p) map[p.ins ? `i${p.ins.id}` : `b${p.bubble}`] = ['ID', 'EX', 'MEM', 'WB'][index] + (index === 0 && g.stall ? ' hold' : '')
    })
    return map
  })
  return <div className="lab-table-scroll"><table className="lab-timing"><caption>Instruction timing from the same execution model. Select a cycle to inspect it; pale columns are ahead of the clock.</caption>
    <thead><tr><th>Instruction</th>{cycles.map((f, index) => <th key={index} className={Math.floor(cursor / 2) === index ? 'current' : ''}><button onClick={() => onSeek(index * 2)} aria-label={`Inspect cycle ${f.state.cycle}`}>{f.state.cycle}</button></th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.title}</th>{cells.map((cell, index) => <td key={index} className={`${index > Math.floor(cursor / 2) ? 'future' : ''} ${index === Math.floor(cursor / 2) ? 'current' : ''}`}><span className={`stage-${cell[row.key]?.split(' ')[0] ?? 'empty'} ${cell[row.key]?.includes('hold') ? 'held' : ''} ${row.key.startsWith('b') ? 'bubble-cell' : ''}`}>{cell[row.key] ?? '·'}</span></td>)}</tr>)}</tbody>
  </table></div>
}

export function PipelineLab() {
  const [example, setExample] = useState(0)
  const [code, setCode] = useState(EXAMPLES[0].code)
  const [registers, setRegisters] = useState(EXAMPLES[0].registers)
  const [memory, setMemory] = useState(EXAMPLES[0].memory)
  const [input, setInput] = useState({ code, registers, memory })
  const [cursor, setCursor] = useState(0)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(false)
  const sim = useMemo(() => { const initial = parseInitial(input.registers, input.memory); return simulate(parseProgram(input.code), initial.regs, initial.memory) }, [input])
  const frame = sim.frames[cursor], s = frame.state, g = frame.signals
  const last = sim.frames.length - 1, finished = cursor === last
  const dirty = input.code !== code || input.registers !== registers || input.memory !== memory
  const deps = useMemo(() => dependencies(sim.program), [sim])
  const choose = (index: number) => {
    const e = EXAMPLES[index]
    setExample(index); setCode(e.code); setRegisters(e.registers); setMemory(e.memory)
    setInput({ code: e.code, registers: e.registers, memory: e.memory }); setCursor(0); setError('')
  }
  const load = () => {
    try {
      const initial = parseInitial(registers, memory)
      simulate(parseProgram(code), initial.regs, initial.memory)
      setInput({ code, registers, memory }); setCursor(0); setError(''); setExample(-1)
    } catch (e) { setError((e as Error).message) }
  }
  const nextState = sim.frames[(Math.floor(cursor / 2) + 1) * 2]?.state ?? sim.final
  const packets = [s.ifid, s.idex, s.exmem, s.memwb]
  const nextPackets = [nextState.ifid, nextState.idex, nextState.exmem, nextState.memwb]
  const memoryAddresses = [...new Set([...Object.keys(s.memory), ...Object.keys(sim.final.memory), ...(s.exmem?.control.MemRead || s.exmem?.control.MemWrite ? [String(s.exmem.result >>> 0)] : [])])].map(Number).sort((a, b) => a - b)
  return <main className="page pipeline-lab">
    <header className="page-head"><p className="crumb">Task 1 · Five-stage pipeline · Forwarding enabled</p><h1>Inside the pipelined processor</h1><p className="lede">Give the clock yourself. Follow each instruction, inspect the pipeline registers, and see exactly why a value is forwarded or a cycle is stalled.</p></header>
    <section className="lab-setup" aria-label="Program setup">
      <div><label htmlFor="lab-example">Choose a forwarding case</label><select id="lab-example" value={example} onChange={e => choose(Number(e.target.value))}>{example === -1 && <option value={-1}>Custom program</option>}{EXAMPLES.map((e, i) => <option key={e.name} value={i}>{i + 1}. {e.name}</option>)}</select>
        <p className="lab-goal">{example >= 0 ? EXAMPLES[example].goal : 'Trace your own straight-line program with the same forwarding and hazard-detection hardware.'}</p>
        <label htmlFor="lab-code">MIPS program</label><textarea id="lab-code" rows={7} spellCheck={false} value={code} onChange={e => setCode(e.target.value)} />
        <button className="lab-primary" onClick={load}>Load program & reset</button>{dirty && <span className="lab-dirty">Edits pending — load to apply</span>}
        {error && <p className="err" role="alert">{error} The previous simulation is still loaded.</p>}
      </div>
      <div><h2>Before you clock</h2><p><b>{sim.program.length} instructions · {sim.frames.length / 2} cycles · {sim.stalls} load-use stall{sim.stalls === 1 ? '' : 's'}</b></p><p>The orange path uses an EX/MEM result; purple uses MEM/WB. A load result is available after MEM. A bubble advances through EX, MEM and WB with no writes.</p>
        <details className="lab-dependencies"><summary>Program dependencies ({deps.length})</summary>{deps.length ? <ul>{deps.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p>No read-after-write dependencies.</p>}</details>
        <details><summary>Initial registers & memory</summary><p className="hint">Unspecified values are zero. Addresses are byte addresses; words must be aligned. Decimal and 0x hexadecimal values are accepted.</p><label htmlFor="lab-registers">Registers (name=value)</label><textarea id="lab-registers" rows={3} value={registers} spellCheck={false} onChange={e => setRegisters(e.target.value)} /><label htmlFor="lab-memory">Memory (address=value)</label><textarea id="lab-memory" rows={3} value={memory} spellCheck={false} onChange={e => setMemory(e.target.value)} /></details>
        <details><summary>Hardware assumptions & source references</summary><p>Chapter 4 Part 2, slides 53–65 and 67–75; accompanying textbook, chapter 11. Register writes occur at the end of the first half; reads occur in the second half (slide 55). Pipeline registers latch together at the end of each cycle.</p><p>The extra MEM/WB → memory store-data path implements slide 66’s memory-copy case. The detector checks actual operands needed in EX; it does not stall for a store’s data alone or an immediate’s destination. ALUOp=00 selects addition, 10 decodes R-format; this model uses 11 for logical/comparison immediates.</p><p>Separate instruction/data memories; one-cycle memory; 32-bit integer values; arithmetic wraps without overflow traps. Fetch stops at the end of the program while the remaining stages drain. Supported: add/addu, sub/subu, and/or/xor/nor, slt/sltu, addi/addiu, andi/ori/xori, slti/sltiu, lw/sw, nop. Branches, jumps, labels, pseudo-instructions and exceptions are outside Task 1.</p></details>
      </div>
    </section>

    <section className="lab-clock" aria-label="Clock controls">
      <div className="lab-clock-title" aria-live="polite"><b>Cycle {s.cycle} / {sim.frames.length / 2}</b><span>{s.half === 0 ? 'First half · WB write pending' : 'Second half · ID reads after WB'}{finished ? ' · Final cycle' : ''}</span></div>
      <div className="lab-clock-buttons"><button onClick={() => setCursor(0)} disabled={cursor === 0}>Reset</button><button onClick={() => setCursor(c => Math.max(0, c - 1))} disabled={cursor === 0}>← Back half</button><button className="lab-primary" onClick={() => setCursor(c => Math.min(last, c + 1))} disabled={finished}>Next half-cycle →</button><button onClick={() => setCursor(c => Math.min(last, c + 2))} disabled={finished}>Next clock +1</button><button onClick={() => setCursor(last)} disabled={finished}>Finish</button></div>
      <label className="lab-scrub">Inspect time<input aria-label="Simulation half-cycle" type="range" min={0} max={last} value={cursor} onChange={e => setCursor(Number(e.target.value))} /></label>
    </section>
    <div className="lab-section-head"><h2>Live datapath</h2><button onClick={() => setZoom(z => !z)} aria-pressed={zoom}>{zoom ? 'Fit diagram' : 'Enlarge diagram'}</button></div>
    <div className={`lab-diagram ${zoom ? 'zoomed' : ''}`}><PipelineDatapath frame={frame} program={sim.program} /></div>
    <div className="lab-signals" aria-label="Live control signals">{[['PCWrite', +!g.stall], ['IF/IDWrite', +!g.stall], ['Zero controls', +g.stall], ['ForwardA', g.a.select], ['ForwardB', g.b.select], ['Store bypass', +g.storeForward]].map(([key, val]) => <div key={key}><span>{key}</span><b>{val}</b></div>)}</div>
    <section className={`lab-explanation ${g.stall ? 'stall' : ''}`}><h2>{g.stall ? 'Hazard detected — freeze the front, drain the back' : s.idex?.bubble ? 'The bubble gives the load time to finish' : finished ? 'Final writeback — pipeline trace complete' : 'What happens in this half-cycle'}</h2><ol>{explain(frame, sim).map((line, i) => <li key={i}>{line}</li>)}</ol></section>
    <section><div className="lab-section-head"><h2>Pipeline register contents</h2><span>Current latches → next clock edge</span></div><div className="lab-latches">{packets.map((p, i) => <article className={`lab-latch ${p?.bubble ? 'bubble' : ''}`} key={i}><h3>{['IF/ID', 'ID/EX', 'EX/MEM', 'MEM/WB'][i]}</h3><p className="lab-packet">{name(p)}</p><dl>{packetFields(p, i).map(([key, val]) => <div key={key}><dt>{key}</dt><dd>{val}</dd></div>)}</dl><p className="lab-next"><b>{g.stall && i === 0 ? 'HOLD' : 'Next edge'}:</b> {name(nextPackets[i])}</p><details><summary>Preview next values</summary><dl>{packetFields(nextPackets[i], i).map(([key, val]) => <div key={key}><dt>{key}</dt><dd>{val}</dd></div>)}</dl></details></article>)}</div></section>
    <section className="lab-timeline"><h2>Instruction-by-instruction timing</h2><TimingChart sim={sim} cursor={cursor} onSeek={setCursor} /></section>
    <section className="lab-state"><div><h2>Architectural registers</h2><p className="hint">Signed decimal · hover for hexadecimal. Green marks this cycle’s WB destination; the value changes between halves.</p><div className="lab-register-grid">{NAMES.map((n, r) => <div key={n} className={g.wb?.dest === r ? 'written' : ''} title={hex(s.regs[r])}><span>${n} <small>({r})</small></span><b>{s.regs[r]}</b></div>)}</div></div><div><h2>Data memory</h2><p className="hint">Stores commit at the cycle edge. Uninitialized words read as 0.</p><table className="lab-memory"><thead><tr><th>Byte address</th><th>Current value</th></tr></thead><tbody>{memoryAddresses.map(address => <tr key={address} className={s.exmem && (s.exmem.control.MemRead || s.exmem.control.MemWrite) && s.exmem.result >>> 0 === address ? 'written' : ''}><td>{hex(address)}</td><td title={hex(s.memory[address] ?? 0)}>{s.memory[address] ?? 0}</td></tr>)}</tbody></table>{!memoryAddresses.length && <p>No memory words initialized or accessed.</p>}</div></section>
  </main>
}
