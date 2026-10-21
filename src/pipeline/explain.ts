// Turns the simulation into clock steps and plain-language explanations.
// Text markup: `code` and **bold**; the page renders it.

import { regName, type Controls, type Cycle, type Fwd, type FwdCheck, type Instr, type Simulation } from './engine.ts'
export type Phase = 'edge' | 'wb' | 'id' | 'ex'
export type Step = { cycle: number; phase: Phase } // cycle is an index into sim.cycles

export const PHASES: { phase: Phase; short: string; long: string }[] = [
  { phase: 'edge', short: '↑ Clock edge', long: 'Pipeline registers latch' },
  { phase: 'wb', short: '1st half', long: 'WB writes registers' },
  { phase: 'id', short: '2nd half', long: 'ID reads · hazard check · IF' },
  { phase: 'ex', short: 'EX + MEM', long: 'Forwarding · ALU · memory' },
]

/** The sub-steps of every cycle. A sub-step whose stages are all empty is skipped. */
export function buildSteps(sim: Simulation): Step[] {
  const steps: Step[] = []
  sim.cycles.forEach((c, i) => {
    steps.push({ cycle: i, phase: 'edge' })
    if (c.at.memwb) steps.push({ cycle: i, phase: 'wb' })
    if (c.at.ifid || c.fetch.instr) steps.push({ cycle: i, phase: 'id' })
    if (c.at.idex || c.at.exmem) steps.push({ cycle: i, phase: 'ex' })
  })
  return steps
}

export type Check = { text: string; ok: boolean }
export type Line = { text: string; tone?: 'ex' | 'mem' | 'hazard' | 'rf' | 'muted'; checks?: Check[]; result?: string }
export type Explanation = { title: string; tone: 'normal' | 'hazard' | 'forward' | 'rf'; lines: Line[] }

const q = (i: Instr) => `\`${i.text}\``
const who = (i: Instr) => `I${i.id + 1} ${q(i)}`

export function controlText(c: Controls, op?: Instr['op']) {
  const x = op === 'sw' ? ['RegDst', 'MemtoReg'] : []
  const v = (k: keyof Controls, s: string) => `${k}=${x.includes(k) ? 'X' : s}`
  return [v('RegDst', String(c.RegDst)), v('ALUOp', c.ALUOp.toString(2).padStart(2, '0')), v('ALUSrc', String(c.ALUSrc)), v('MemRead', String(c.MemRead)), v('MemWrite', String(c.MemWrite)), v('RegWrite', String(c.RegWrite)), v('MemtoReg', String(c.MemtoReg))].join(' ')
}

function edge(sim: Simulation, k: number): Explanation {
  const c = sim.cycles[k]
  if (k === 0) {
    return {
      title: 'Cycle 1 begins: the pipeline is empty',
      tone: 'normal',
      lines: [
        { text: `PC = 0. All four pipeline registers are empty. Every click on **Next** moves to the next sub-step of the clock cycle: ↑ edge → 1st half → 2nd half → EX + MEM.` },
        { text: `The first instruction, ${who(sim.program[0])}, is fetched in this cycle.` },
      ],
    }
  }
  const p = sim.cycles[k - 1]
  const lines: Line[] = []
  const stalled = p.hazard.stall
  lines.push(stalled
    ? { text: `**PC held** at ${c.at.pc} (PCWrite was 0), so ${c.fetch.instr ? q(c.fetch.instr) : 'the same instruction'} is fetched again.`, tone: 'hazard' }
    : { text: `PC ← ${c.at.pc}${c.at.pc === p.at.pc ? ' (no more instructions to fetch)' : ''}.` })
  if (stalled) lines.push({ text: `**IF/ID held** (IF/IDWrite was 0): ${c.at.ifid ? who(c.at.ifid.instr) : 'it'} stays in ID and is decoded again.`, tone: 'hazard' })
  else lines.push({ text: c.at.ifid ? `IF/ID ← ${who(c.at.ifid.instr)}, just fetched, with PC + 4 = ${c.at.ifid.pc4}.` : 'IF/ID ← empty.' })
  const idex = c.at.idex
  if (idex?.bubble) lines.push({ text: `**ID/EX ← bubble.** The control mux chose 0, so every WB, M and EX control bit is 0 (slide 71). The data fields still hold ${q(idex.instr)}'s values, but with all controls 0 nothing uses them.`, tone: 'hazard' })
  else lines.push({ text: idex ? `ID/EX ← ${who(idex.instr)}: its controls, register values, immediate and the register numbers Rs, Rt, Rd.` : 'ID/EX ← empty.' })
  const em = c.at.exmem
  lines.push({ text: em ? (em.bubble ? 'EX/MEM ← the bubble (controls 0).' : `EX/MEM ← ${who(em.instr)}: ALU result ${em.aluResult}${em.ctrl.MemWrite ? `, write data ${em.writeData}` : ''}${em.ctrl.RegWrite ? `, destination ${regName(em.regRd)}` : ''}.`) : 'EX/MEM ← empty.' })
  const mw = c.at.memwb
  lines.push({ text: mw ? (mw.bubble ? 'MEM/WB ← the bubble (controls 0).' : `MEM/WB ← ${who(mw.instr)}${mw.ctrl.MemRead ? `: data read from memory = ${mw.readData}` : mw.ctrl.RegWrite ? `: ALU result ${mw.aluResult}` : ''}${mw.ctrl.RegWrite ? `, destination ${regName(mw.regRd)}` : ''}.`) : 'MEM/WB ← empty.' })
  if (p.mem?.write) lines.push({ text: `Data memory: Mem[${p.mem.address}] ← ${p.at.exmem!.writeData} was written at this edge.`, tone: 'mem' })
  return { title: `↑ Clock edge: cycle ${c.n} begins${stalled ? ' (after a stall)' : ''}`, tone: stalled ? 'hazard' : 'normal', lines }
}

function writeBack(c: Cycle): Explanation {
  const mw = c.at.memwb!
  const lines: Line[] = []
  if (mw.bubble) {
    lines.push({ text: 'MEM/WB holds the bubble: RegWrite = 0, so nothing is written. The stall is now finished.', tone: 'muted' })
    return { title: 'First half: the bubble leaves the pipeline', tone: 'normal', lines }
  }
  const wb = c.wb!
  const i = mw.instr
  if (!wb.regWrite) {
    lines.push({ text: `${who(i)} has RegWrite = 0 (a store writes no register). It already finished its work in MEM, so nothing happens here.`, tone: 'muted' })
    return { title: 'First half: nothing to write', tone: 'normal', lines }
  }
  lines.push({ text: `MemtoReg = ${wb.memtoReg}, so the WB mux picks ${wb.memtoReg ? `the **data read from memory**` : `the **ALU result**`}: ${wb.value}.` })
  if (wb.writes) {
    lines.push({ text: `RegWrite = 1: **${regName(wb.rd)} ← ${wb.value}** in the first half of the cycle (it was ${wb.old}).`, tone: 'rf' })
    const reader = c.id && (c.id.sameCycleRs || c.id.sameCycleRt) ? c.id.instr : null
    if (reader) lines.push({ text: `${who(reader)} in ID reads ${regName(wb.rd)} in the **second half**, so it already gets ${wb.value}. No forwarding needed (slide 55).`, tone: 'rf' })
  } else {
    lines.push({ text: `The destination is $zero. The register file ignores the write; $zero stays 0.`, tone: 'muted' })
  }
  return { title: `First half: WB writes ${wb.writes ? regName(wb.rd) : 'nothing'}`, tone: 'rf', lines }
}

function decode(c: Cycle): Explanation {
  const lines: Line[] = []
  const h = c.hazard
  const d = c.id
  if (d) {
    const i = d.instr
    lines.push({ text: `ID decodes ${who(i)}: Rs = ${regName(i.rs)}, Rt = ${regName(i.rt)}, Rd = ${regName(i.rd)}, sign-extended immediate = ${i.imm}${i.op === 'lw' || i.op === 'sw' || i.op === 'addi' ? '' : ' (for R-format these bits are rd and funct; the ALU control uses the funct bits)'}. All of them go into ID/EX, whether this instruction uses them or not.` })
    lines.push({
      text: `Second half: reads ${regName(i.rs)} = ${d.data1} and ${regName(i.rt)} = ${d.data2}${d.sameCycleRs || d.sameCycleRt ? ` (${regName(c.wb!.rd)} was written in the first half, so this is the new value)` : ''}.`,
      tone: d.sameCycleRs || d.sameCycleRt ? 'rf' : undefined,
    })
    lines.push({ text: `Control unit: ${controlText(d.ctrl, i.op)}.`, tone: 'muted' })
    const e = c.at.idex
    if (!e) {
      lines.push({ text: 'Hazard detection unit: EX is empty, so there is nothing to compare. No stall.' })
    } else {
      const checks: Check[] = [
        { text: `ID/EX.MemRead = ${h.memRead}`, ok: !!h.memRead },
        { text: `ID/EX.RegisterRt (${regName(h.idexRt)}) = IF/ID.RegisterRs (${regName(h.ifidRs)})`, ok: h.matchRs },
        { text: `ID/EX.RegisterRt (${regName(h.idexRt)}) = IF/ID.RegisterRt (${regName(h.ifidRt)})`, ok: h.matchRt },
      ]
      lines.push({ text: 'Hazard detection unit (slide 69): ID/EX.MemRead **and** (rt = rs **or** rt = rt)', checks, result: h.stall ? 'STALL' : 'no stall', tone: h.stall ? 'hazard' : undefined })
      if (h.stall) {
        const load = e.instr
        lines.push({ text: `**Load-use hazard.** ${who(load)} is in EX. Its data comes out of memory only at the end of the next cycle (MEM). ${q(i)} would need it at the start of the next cycle (EX). Forwarding cannot send data backward in time (slide 67).`, tone: 'hazard' })
        lines.push({ text: `So the unit sets **PCWrite = 0**, **IF/IDWrite = 0** and **Stall = 1**. At the next edge: the PC and IF/ID keep their values, and the control mux sends 0s into ID/EX: a bubble (slide 72).`, tone: 'hazard' })
        if (h.conservative) lines.push({ text: `Note: ${q(i)} does not read ${regName(h.idexRt)}. Rt is its destination. The slide-69 unit only compares register numbers, so it stalls anyway.`, tone: 'muted' })
        else if (i.op === 'sw' && !h.matchRs) lines.push({ text: `Note: sw needs ${regName(h.idexRt)} only as store data. Slide 66 asks when that data is really needed (in MEM). The slide-69 unit does not look at that: it sees a matching rt and stalls.`, tone: 'muted' })
      } else if (h.memRead) {
        lines.push({ text: `${who(e.instr)} is a load, but it loads ${regName(h.idexRt)}, which ${q(i)} does not use. No stall.` })
      } else {
        lines.push({ text: `${e.bubble ? 'EX holds a bubble' : `${who(e.instr)} in EX is not a load`} (MemRead = 0). Any value it produces can be forwarded in time. No stall.` })
      }
    }
  }
  const f = c.fetch.instr
  if (f) lines.push(h.stall
    ? { text: `IF fetches ${who(f)} at address ${c.fetch.pc}. Because PCWrite = 0 the PC does not advance, so the same instruction is fetched again next cycle.`, tone: 'hazard' }
    : { text: `IF fetches ${who(f)} at address ${c.fetch.pc}. At the next edge: PC ← ${c.fetch.pc4}, IF/ID ← this instruction.` })
  else lines.push({ text: 'IF: there are no more instructions to fetch.', tone: 'muted' })
  return { title: h.stall ? 'Second half: hazard detected, stall' : 'Second half: ID reads registers · hazard check · IF fetches', tone: h.stall ? 'hazard' : 'normal', lines }
}

function cond(k: FwdCheck, field: 'Rs' | 'Rt', reg: number): Check[] {
  if (!k.present) return [{ text: `${k.from} is empty`, ok: false }]
  return [
    { text: `${k.from}.RegWrite = ${k.regWrite}`, ok: !!k.regWrite },
    { text: `${k.from}.RegisterRd (${regName(k.rd)}) ≠ 0`, ok: k.nonZero },
    { text: `${k.from}.RegisterRd (${regName(k.rd)}) = ID/EX.Register${field} (${regName(reg)})`, ok: k.match },
  ]
}

function forwardLines(f: Fwd, c: Cycle): Line[] {
  const name = f.field === 'Rs' ? 'ForwardA' : 'ForwardB'
  const lines: Line[] = []
  const src = f.sel === '10' ? c.at.exmem! : f.sel === '01' ? c.at.memwb! : null
  lines.push({ text: `**${name}** (ALU input ${f.field === 'Rs' ? 'A' : 'B'}, ID/EX.Register${f.field} = ${regName(f.reg)}). EX hazard, slide 61:`, checks: cond(f.ex, f.field, f.reg), result: f.ex.holds ? `${name} = 10` : 'false' })
  lines.push({ text: `MEM hazard, slide 64 (only if the EX hazard is false):`, checks: [...cond(f.mem, f.field, f.reg), { text: 'not EX hazard', ok: !f.ex.holds }], result: !f.ex.holds && f.mem.holds ? `${name} = 01` : 'false' })
  if (f.sel === '10') lines.push({ text: `→ **${name} = 10**: the value ${f.value} comes from EX/MEM: the ALU result of ${who(src!.instr)}, which is now in MEM.`, tone: 'ex' })
  else if (f.sel === '01') lines.push({ text: `→ **${name} = 01**: the value ${f.value} comes from MEM/WB: ${src!.ctrl.MemtoReg ? 'the data loaded by ' : 'the ALU result of '}${who(src!.instr)}, which is now in WB.`, tone: 'mem' })
  else lines.push({ text: `→ ${name} = 00: the value ${f.value} read from the register file in ID is used.` })
  if (f.double) lines.push({ text: `**Double data hazard** (slides 62–64): MEM/WB also holds a new ${regName(f.reg)} (${c.wb!.value}), but it is older. The revised MEM condition rejects it, and the newest value ${f.value} from EX/MEM wins.`, tone: 'ex' })
  if (f.unused && f.sel !== '00') lines.push({ text: `Rt of ${q(c.at.idex!.instr)} is its destination, not a source. The forwarding unit still matches the number, but ALUSrc = 1 chooses the immediate, so the forwarded value is not used.`, tone: 'muted' })
  return lines
}

function aluText(op: string, a: number, b: number) {
  if (op === 'slt') return `(${a} < ${b} ? 1 : 0)`
  if (op === 'nor') return `NOT(${a} OR ${b})`
  const sym: Record<string, string> = { add: '+', sub: '−', and: 'AND', or: 'OR' }
  return `${a} ${sym[op]} ${b < 0 && op !== 'and' && op !== 'or' ? `(${b})` : b}`
}

function execute(c: Cycle): Explanation {
  const lines: Line[] = []
  const e = c.at.idex
  let forwarded = false
  if (e?.bubble) {
    lines.push({ text: `EX holds the **bubble**. The forwarding unit and the ALU still work on the leftover fields of ${q(e.instr)}, but all its controls are 0: RegWrite = MemRead = MemWrite = 0, so the result is never stored or written anywhere.`, tone: 'muted' })
  } else if (e && c.ex) {
    const x = c.ex
    lines.push(...forwardLines(x.fa, c))
    if (e.instr.op === 'sw' || !x.fb.unused) lines.push(...forwardLines(x.fb, c))
    else lines.push({ text: `ForwardB = ${x.fb.sel}${x.fb.unused && x.fb.sel !== '00' ? ' (not used)' : ''}: ${q(e.instr)} has no rt source. ALUSrc = 1 selects the immediate.`, tone: 'muted' })
    forwarded = x.fa.sel !== '00' || (x.fb.sel !== '00' && !x.fb.unused)
    lines.push({ text: `ALUSrc = ${e.ctrl.ALUSrc}: ALU input B = ${e.ctrl.ALUSrc ? `the sign-extended immediate ${e.imm}` : `the ForwardB mux output ${x.fb.value}`}. ALU control (ALUOp = ${e.ctrl.ALUOp.toString(2).padStart(2, '0')}${e.ctrl.ALUOp === 2 ? `, funct = ${(e.imm & 63).toString(2).padStart(6, '0')}` : ''}) → **${x.aluCtl.name}**: ${aluText(x.aluCtl.name, x.aluA, x.aluB)} = **${x.result}**.` })
    if (e.ctrl.MemWrite) lines.push({ text: `Store data: the ForwardB mux output (${x.writeData}) goes into EX/MEM as the data memory write data.` })
    if (e.ctrl.RegWrite) lines.push({ text: `RegDst = ${e.ctrl.RegDst}: the destination is ${e.ctrl.RegDst ? 'Rd' : 'Rt'} = ${regName(x.regDst)}. It travels on as EX/MEM.RegisterRd.`, tone: 'muted' })
  }
  const m = c.at.exmem
  if (m?.bubble) lines.push({ text: 'MEM holds the bubble: MemRead = MemWrite = 0, so memory is not touched.', tone: 'muted' })
  else if (m && c.mem?.read) lines.push({ text: `MEM: ${who(m.instr)} reads Mem[${c.mem.address}] = **${c.mem.readData}**. It goes into MEM/WB at the next edge, and from there it can be forwarded (01) to the instruction in EX.`, tone: 'mem' })
  else if (m && c.mem?.write) lines.push({ text: `MEM: ${who(m.instr)} writes **${m.writeData}** to Mem[${c.mem.address}] at the end of this cycle.`, tone: 'mem' })
  else if (m) lines.push({ text: `MEM: ${who(m.instr)} does not access memory. Its ALU result ${m.aluResult} goes to MEM/WB.`, tone: 'muted' })
  return { title: forwarded ? 'EX + MEM: forwarding in action' : 'EX + MEM: ALU and data memory', tone: forwarded ? 'forward' : 'normal', lines }
}

export function explain(sim: Simulation, step: Step): Explanation {
  const c = sim.cycles[step.cycle]
  if (step.phase === 'edge') return edge(sim, step.cycle)
  if (step.phase === 'wb') return writeBack(c)
  if (step.phase === 'id') return decode(c)
  return execute(c)
}
