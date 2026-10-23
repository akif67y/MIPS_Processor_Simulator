// Turns the simulation into clock steps and plain-language explanations.
// Text markup: `code` and **bold**; the page renders it.

import type { Unit } from './units.ts'
import { isBranch, regName, type CmpFwd, type Controls, type Cycle, type Fwd, type FwdCheck, type Instr, type Simulation, type Squash } from './engine.ts'
export type Phase = 'edge' | 'wb' | 'id' | 'ex' | 'br' | 'all' // 'all' = the whole cycle at once
export type Step = { cycle: number; phase: Phase } // cycle is an index into sim.cycles

// The focus steps are a reading order, not a time order: only the edge and the register file's
// write-then-read (slide 55) are ordered; IF, ID, EX and MEM all work during the whole cycle.
export const PHASES: { phase: Phase; short: string; long: string }[] = [
  { phase: 'edge', short: '↑ Edge', long: 'Pipeline registers latch' },
  { phase: 'wb', short: 'WB write', long: 'First half: WB writes the register file' },
  { phase: 'id', short: 'ID read · IF', long: 'Second half: ID reads registers; the hazard check and IF run all cycle' },
  { phase: 'ex', short: 'EX · MEM', long: 'Forwarding, ALU and data memory, running all cycle in parallel with IF and ID' },
  { phase: 'br', short: 'Branch', long: 'Branch decision · next PC · flush' },
]
/** The sub-steps a lesson shows in its toolbar (the branch step only exists with branch hardware). */
export const phasesFor = (sim: Simulation) => PHASES.filter((p) => p.phase !== 'br' || !!sim.hw.branch)

export type ViewMode = 'whole' | 'focus'

/** The sub-steps of every cycle. A sub-step whose stages are all empty is skipped.
 *  In 'whole' mode there is one step per cycle. */
export function buildSteps(sim: Simulation, mode: ViewMode = 'focus'): Step[] {
  if (mode === 'whole') return sim.cycles.map((_, i) => ({ cycle: i, phase: 'all' as const }))
  const steps: Step[] = []
  sim.cycles.forEach((c, i) => {
    steps.push({ cycle: i, phase: 'edge' })
    if (c.at.memwb) steps.push({ cycle: i, phase: 'wb' })
    if (c.at.ifid || c.fetch.instr) steps.push({ cycle: i, phase: 'id' })
    if (c.at.idex || c.at.exmem) steps.push({ cycle: i, phase: 'ex' })
    if (c.branch || c.waiting) steps.push({ cycle: i, phase: 'br' })
  })
  return steps
}

export type Check = { text: string; ok: boolean }
export type Stage = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB'
/** `at`: the unit the line talks about (the studio view pins it there); none = no single location.
 *  `label`: the key value, shown next to the pin. */
export type Line = { text: string; tone?: 'ex' | 'mem' | 'hazard' | 'rf' | 'muted' | 'branch' | 'flush'; checks?: Check[]; result?: string; stage?: Stage; at?: Unit; label?: string }

/** The meaning of a check result: forwarding from EX/MEM or MEM/WB, a stall, or nothing. */
export function resultTone(result: string): 'ex' | 'mem' | 'hazard' | null {
  if (result === 'false' || result === 'no stall') return null
  if (/= 10|^forward/.test(result)) return 'ex'
  if (/= 01/.test(result)) return 'mem'
  if (/STALL/.test(result)) return 'hazard'
  return null
}
export type Explanation = { title: string; tone: 'normal' | 'hazard' | 'forward' | 'rf' | 'branch' | 'flush'; lines: Line[] }

const q = (i: Instr) => `\`${i.text}\``
const who = (i: Instr) => `I${i.id + 1} ${q(i)}`
const was = (s: Squash) => `${who(s.instr)} (${s.why === 'flush' ? 'flushed' : 'discarded while waiting for the branch'})`

export function controlText(c: Controls, op?: Instr['op'], branch = false) {
  const x = op === 'sw' || isBranch(op) ? ['RegDst', 'MemtoReg'] : []
  const v = (k: keyof Controls, s: string) => `${k}=${x.includes(k) ? 'X' : s}`
  return [v('RegDst', String(c.RegDst)), v('ALUOp', c.ALUOp.toString(2).padStart(2, '0')), v('ALUSrc', String(c.ALUSrc)), ...(branch ? [v('Branch', String(c.Branch))] : []), v('MemRead', String(c.MemRead)), v('MemWrite', String(c.MemWrite)), v('RegWrite', String(c.RegWrite)), v('MemtoReg', String(c.MemtoReg))].join(' ')
}

/** What a pipeline register holds, in words. */
function slot(p: { instr: Instr; bubble?: boolean; squashed?: Squash } | null): string {
  if (!p) return 'empty'
  if (p.squashed) return p.bubble ? `a flushed slot, controls 0 (was ${was(p.squashed)})` : `the nop left by IF.Flush (was ${was(p.squashed)})`
  if (p.bubble) return 'the bubble (controls 0)'
  return who(p.instr)
}

function edge(sim: Simulation, k: number): Explanation {
  const c = sim.cycles[k]
  if (k === 0) {
    return {
      title: 'Cycle 1 begins: the pipeline is empty',
      tone: 'normal',
      lines: [
        { text: `PC = ${c.at.pc}. All four pipeline registers are empty. Every click on **Next** moves to the next sub-step of the clock cycle: ↑ edge → 1st half → 2nd half → EX + MEM${sim.hw.branch ? ' → Branch (only when a branch is decided)' : ''}.` },
        { text: `The first instruction, ${who(sim.program[0])}, is fetched in this cycle.`, at: 'imem' },
      ],
    }
  }
  const p = sim.cycles[k - 1]
  const lines: Line[] = []
  const stalled = p.hazard.stall && !p.hazard.overridden
  const flushed = p.squash?.why === 'flush'
  if (p.pcSrc) lines.push({ text: `**PC ← ${c.at.pc}**, the branch target: PCSrc was 1, so the PC mux chose the target instead of PC + 4.`, tone: 'branch', at: 'pc' })
  else if (p.waiting && c.at.pc === p.at.pc) lines.push({ text: `**PC held** at ${c.at.pc}: the pipeline is still waiting for the branch, so the same address is fetched again.`, tone: 'flush', at: 'pc' })
  else if (stalled) lines.push({ text: `**PC held** at ${c.at.pc} (PCWrite was 0), so ${c.fetch.instr ? q(c.fetch.instr) : 'the same instruction'} is fetched again.`, tone: 'hazard', at: 'pc' })
  else lines.push({ text: `PC ← ${c.at.pc}${c.at.pc === p.at.pc ? ' (no more instructions to fetch)' : ''}.`, at: 'pc' })
  const ifid = c.at.ifid
  if (stalled) lines.push({ text: `**IF/ID held** (IF/IDWrite was 0): ${ifid ? who(ifid.instr) : 'it'} stays in ID and is decoded again.`, tone: 'hazard', at: 'ifid' })
  else if (ifid?.squashed?.why === 'flush') lines.push({ text: `**IF/ID ← nop.** IF.Flush cleared the instruction word of ${who(ifid.squashed.instr)} to 0, and the all-zero word is \`nop\`. It goes down the pipeline doing nothing.`, tone: 'flush', at: 'ifid' })
  else if (ifid?.squashed) lines.push({ text: `**IF/ID ← nop.** ${who(ifid.squashed.instr)} was fetched while the branch was undecided, so IF.Flush threw it away (stall on branch, slides 26–27).`, tone: 'flush', at: 'ifid' })
  else lines.push({ text: ifid ? `IF/ID ← ${who(ifid.instr)}, just fetched, with PC + 4 = ${ifid.pc4}.` : 'IF/ID ← empty.', at: ifid ? 'ifid' : undefined })
  const idex = c.at.idex
  if (idex?.bubble && idex.squashed && flushed && p.squash?.idex) lines.push({ text: `**ID/EX ← bubble.** ID.Flush zeroed every control bit of ${who(idex.squashed.instr)}, which was in ID on the wrong path (slide 77: set control values to 0).`, tone: 'flush', at: 'idex' })
  else if (idex?.bubble && !idex.squashed) lines.push({ text: `**ID/EX ← bubble.** The control mux chose 0, so every WB, M and EX control bit is 0 (slide 71). The data fields still hold ${q(idex.instr)}'s values, but with all controls 0 nothing uses them.`, tone: 'hazard', at: 'idex' })
  else if (idex && !idex.bubble && !idex.squashed) lines.push({ text: `ID/EX ← ${who(idex.instr)}: its controls, register values, immediate and the register numbers Rs, Rt, Rd.`, at: 'idex' })
  else lines.push({ text: `ID/EX ← ${slot(idex)}.`, tone: idex ? 'muted' : undefined, at: idex ? 'idex' : undefined })
  const em = c.at.exmem
  if (em?.squashed && flushed && p.squash?.exmem) lines.push({ text: `**EX/MEM ← bubble.** EX.Flush zeroed the controls of ${who(em.squashed.instr)}, which was in EX on the wrong path.`, tone: 'flush', at: 'exmem' })
  else if (em && !em.bubble && !em.squashed) lines.push({ text: `EX/MEM ← ${who(em.instr)}: ALU result ${em.aluResult}${em.ctrl.MemWrite ? `, write data ${em.writeData}` : ''}${em.ctrl.RegWrite ? `, destination ${regName(em.regRd)}` : ''}${sim.hw.branch === 'mem' && em.ctrl.Branch ? `, branch target ${em.target}, Zero = ${em.zero}` : ''}.`, at: 'exmem' })
  else lines.push({ text: `EX/MEM ← ${slot(em)}.`, tone: em ? 'muted' : undefined, at: em ? 'exmem' : undefined })
  const mw = c.at.memwb
  if (mw && !mw.bubble && !mw.squashed) lines.push({ text: `MEM/WB ← ${who(mw.instr)}${mw.ctrl.MemRead ? `: data read from memory = ${mw.readData}` : mw.ctrl.RegWrite ? `: ALU result ${mw.aluResult}` : ''}${mw.ctrl.RegWrite ? `, destination ${regName(mw.regRd)}` : ''}.`, at: 'memwb' })
  else lines.push({ text: `MEM/WB ← ${slot(mw)}.`, tone: mw ? 'muted' : undefined, at: mw ? 'memwb' : undefined })
  if (p.mem?.write) lines.push({ text: `Data memory: Mem[${p.mem.address}] ← ${p.at.exmem!.writeData} was written at this edge.`, tone: 'mem', at: 'dmem' })
  const tone = p.pcSrc && flushed ? 'flush' : p.pcSrc ? 'branch' : p.waiting ? 'flush' : stalled ? 'hazard' : 'normal'
  return { title: `↑ Clock edge: cycle ${c.n} begins${p.pcSrc ? (flushed ? ' (branch taken, flush)' : ' (branch taken)') : p.waiting ? ' (waiting for a branch)' : stalled ? ' (after a stall)' : ''}`, tone, lines }
}

function writeBack(c: Cycle): Explanation {
  const mw = c.at.memwb!
  const lines: Line[] = []
  if (mw.squashed) {
    lines.push({ text: `MEM/WB holds what is left of ${was(mw.squashed)}. ${mw.bubble ? 'Its controls are 0' : 'It is a nop (it can only write $zero)'}, so nothing is written. The thrown-away slot leaves the pipeline.`, tone: 'muted' })
    return { title: 'First half: a flushed slot leaves the pipeline', tone: 'normal', lines }
  }
  if (mw.bubble) {
    lines.push({ text: 'MEM/WB holds the bubble: RegWrite = 0, so nothing is written. The stall is now finished.', tone: 'muted' })
    return { title: 'First half: the bubble leaves the pipeline', tone: 'normal', lines }
  }
  const wb = c.wb!
  const i = mw.instr
  if (!wb.regWrite) {
    lines.push({ text: `${who(i)} has RegWrite = 0 (${isBranch(i.op) ? 'a branch' : 'a store'} writes no register). It already finished its work${isBranch(i.op) ? '' : ' in MEM'}, so nothing happens here.`, tone: 'muted' })
    return { title: 'First half: nothing to write', tone: 'normal', lines }
  }
  lines.push({ text: `MemtoReg = ${wb.memtoReg}, so the WB mux picks ${wb.memtoReg ? `the **data read from memory**` : `the **ALU result**`}: ${wb.value}.`, at: 'wbMux', label: `MemtoReg = ${wb.memtoReg}` })
  if (wb.writes) {
    lines.push({ text: `RegWrite = 1: **${regName(wb.rd)} ← ${wb.value}** in the first half of the cycle (it was ${wb.old}).`, tone: 'rf', at: 'rfWrite', label: `${regName(wb.rd)} ← ${wb.value}` })
    const reader = c.id && (c.id.sameCycleRs || c.id.sameCycleRt) ? c.id.instr : null
    if (reader) lines.push({ text: `${who(reader)} in ID reads ${regName(wb.rd)} in the **second half**, so it already gets ${wb.value}. No forwarding needed (slide 55).`, tone: 'rf', at: 'rfRead' })
  } else {
    lines.push({ text: `The destination is $zero. The register file ignores the write; $zero stays 0.`, tone: 'muted' })
  }
  return { title: `First half: WB writes ${wb.writes ? regName(wb.rd) : 'nothing'}`, tone: 'rf', lines }
}

function branchHazardLines(c: Cycle, i: Instr): Line[] {
  const b = c.hazard.branch!
  const lines: Line[] = []
  const e = c.at.idex, m = c.at.exmem
  const checks: Check[] = [
    { text: `ID/EX.RegWrite = ${b.idexRegWrite}`, ok: !!b.idexRegWrite },
    { text: `ID/EX destination (${regName(b.idexDest)}) = IF/ID.RegisterRs (${regName(i.rs)}) or Rt (${regName(i.rt)})`, ok: b.aluRs || b.aluRt },
  ]
  lines.push({ text: 'Branch check 1 (slides 80–81): is the instruction in **EX** about to write a register the comparator needs?', checks, result: b.aluRs || b.aluRt ? 'STALL' : 'no stall', tone: b.aluRs || b.aluRt ? 'hazard' : undefined, at: 'hdu' })
  const checks2: Check[] = [
    { text: `EX/MEM.MemRead = ${b.exmemMemRead}`, ok: !!b.exmemMemRead },
    { text: `EX/MEM.RegisterRd (${regName(b.exmemRd)}) = IF/ID.RegisterRs or Rt`, ok: b.loadRs || b.loadRt },
  ]
  lines.push({ text: 'Branch check 2 (slides 80–81): is a **load in MEM** about to write a register the comparator needs?', checks: checks2, result: b.loadRs || b.loadRt ? 'STALL' : 'no stall', tone: b.loadRs || b.loadRt ? 'hazard' : undefined, at: 'hdu' })
  if (b.aluRs || b.aluRt) {
    const reg = regName(b.idexDest)
    lines.push(b.idexLoad
      ? { text: `**Load right before the branch (slide 81).** ${who(e!.instr)} is in EX; ${reg} comes out of data memory only at the end of the next cycle. The comparator works in ID now, so ${q(i)} must wait: this is the first of **two** stall cycles.`, tone: 'hazard', at: 'hdu' }
      : { text: `**ALU instruction right before the branch (slide 80).** ${who(e!.instr)} is in EX; its result ${reg} exists only at the end of this cycle. The comparator works in ID now, so ${q(i)} waits one cycle. Next cycle the value is in EX/MEM and is forwarded to the comparator.`, tone: 'hazard', at: 'hdu' })
  } else if (b.loadRs || b.loadRt) {
    lines.push({ text: `**Load two instructions before the branch (slide 80), or the second stall of slide 81.** ${who(m!.instr)} is in MEM; ${regName(b.exmemRd)} leaves data memory only at the end of this cycle. EX/MEM holds only its address, so nothing useful can be forwarded. Next cycle the load is in WB: written in the first half, read by the branch in the second half.`, tone: 'hazard', at: 'hdu' })
  }
  if (b.stall) lines.push({ text: `So the unit sets **PCWrite = 0**, **IF/IDWrite = 0** and **Stall = 1**, exactly as for a load-use hazard: PC and IF/ID hold, a bubble goes into ID/EX. The branch is decided after the stall.`, tone: 'hazard', at: 'hdu' })
  return lines
}

function decode(sim: Simulation, c: Cycle): Explanation {
  const lines: Line[] = []
  const h = c.hazard
  const d = c.id
  if (d) {
    const i = d.instr
    const sq = c.at.ifid?.squashed
    if (sq) {
      lines.push({ text: `ID holds the nop left by ${was(sq)}: register numbers 0, controls of \`sll $0, $0, 0\`. It cannot hurt anything.`, tone: 'muted' })
    } else {
      lines.push({ text: `ID decodes ${who(i)}: Rs = ${regName(i.rs)}, Rt = ${regName(i.rt)}, Rd = ${regName(i.rd)}, sign-extended immediate = ${i.imm}${i.op === 'lw' || i.op === 'sw' || i.op === 'addi' ? '' : isBranch(i.op) ? ` (the branch offset in words: target = PC + 4 + ${i.imm} × 4 = ${i.target})` : ' (for R-format these bits are rd and funct; the ALU control uses the funct bits)'}. All of them go into ID/EX, whether this instruction uses them or not.`, at: 'ifid' })
      lines.push({
        text: `Second half: reads ${regName(i.rs)} = ${d.data1} and ${regName(i.rt)} = ${d.data2}${d.sameCycleRs || d.sameCycleRt ? ` (${regName(c.wb!.rd)} was written in the first half, so this is the new value)` : ''}.`,
        tone: d.sameCycleRs || d.sameCycleRt ? 'rf' : undefined,
        at: 'rfRead',
        label: `${regName(i.rs)} = ${d.data1}, ${regName(i.rt)} = ${d.data2}`,
      })
      lines.push({ text: `Control unit: ${controlText(d.ctrl, i.op, !!sim.hw.branch)}.`, tone: 'muted', at: 'control' })
    }
    const e = c.at.idex
    if (!e && !h.branch) {
      lines.push({ text: 'Hazard detection unit: EX is empty, so there is nothing to compare. No stall.', at: 'hdu' })
    } else if (e) {
      const checks: Check[] = [
        { text: `ID/EX.MemRead = ${h.memRead}`, ok: !!h.memRead },
        { text: `ID/EX.RegisterRt (${regName(h.idexRt)}) = IF/ID.RegisterRs (${regName(h.ifidRs)})`, ok: h.matchRs },
        { text: `ID/EX.RegisterRt (${regName(h.idexRt)}) = IF/ID.RegisterRt (${regName(h.ifidRt)})`, ok: h.matchRt },
      ]
      lines.push({ text: 'Hazard detection unit (slide 69): ID/EX.MemRead **and** (rt = rs **or** rt = rt)', checks, result: h.loadUse ? 'STALL' : 'no stall', tone: h.loadUse ? 'hazard' : undefined, at: 'hdu' })
      if (h.loadUse && !h.branch?.stall) {
        const load = e.instr
        lines.push({ text: `**Load-use hazard.** ${who(load)} is in EX. Its data comes out of memory only at the end of the next cycle (MEM). ${q(i)} would need it at the start of the next cycle (EX). Forwarding cannot send data backward in time (slide 67).`, tone: 'hazard', at: 'hdu' })
        lines.push({ text: `So the unit sets **PCWrite = 0**, **IF/IDWrite = 0** and **Stall = 1**. At the next edge: the PC and IF/ID keep their values, and the control mux sends 0s into ID/EX: a bubble (slide 72).`, tone: 'hazard', at: 'hdu' })
        if (h.conservative) lines.push({ text: `Note: ${q(i)} does not read ${regName(h.idexRt)}. Rt is its destination. The slide-69 unit only compares register numbers, so it stalls anyway.`, tone: 'muted', at: 'hdu' })
        else if (i.op === 'sw' && !h.matchRs) lines.push({ text: `Note: sw needs ${regName(h.idexRt)} only as store data. Slide 66 asks when that data is really needed (in MEM). The slide-69 unit does not look at that: it sees a matching rt and stalls.`, tone: 'muted', at: 'hdu' })
      } else if (!h.loadUse && h.memRead) {
        lines.push({ text: `${who(e.instr)} is a load, but it loads ${regName(h.idexRt)}, which ${q(i)} does not use. No stall.`, at: 'hdu' })
      } else if (!h.loadUse && !h.branch) {
        lines.push({ text: `${e.bubble || e.squashed ? 'EX holds a bubble' : `${who(e.instr)} in EX is not a load`} (MemRead = 0). Any value it produces can be forwarded in time. No stall.`, at: 'hdu' })
      }
    }
    if (h.branch) lines.push(...branchHazardLines(c, i))
    if (h.overridden) lines.push({ text: `But a taken branch is in MEM this cycle: these instructions are on the wrong path and will be flushed, so the flush wins over the stall (see the Branch step).`, tone: 'flush', at: 'hdu' })
    if (!h.stall && isBranch(i.op) && !sq) {
      if (sim.hw.branch === 'id') lines.push({ text: `The comparator and the target adder decide ${q(i)} now, in ID. See the **Branch** step.`, tone: 'branch' })
      else if (sim.hw.policy === 'stall') lines.push({ text: `Control sees a branch. With **stall on branch**, everything IF fetches until the branch is decided in MEM is thrown away.`, tone: 'flush' })
      else lines.push({ text: `This branch is decided only in MEM, two cycles from now. Meanwhile IF keeps fetching the next instructions in order (**predict not taken**).`, tone: 'branch' })
    }
  }
  const f = c.fetch.instr
  const stalled = h.stall && !h.overridden
  if (f) lines.push(stalled
    ? { text: `IF fetches ${who(f)} at address ${c.fetch.pc}. Because PCWrite = 0 the PC does not advance, so the same instruction is fetched again next cycle.`, tone: 'hazard', at: 'imem' }
    : c.waiting
      ? { text: `IF fetches ${who(f)} at address ${c.fetch.pc}, but a branch is still undecided, so this fetch will be thrown away at the next edge.`, tone: 'flush', at: 'imem' }
      : { text: `IF fetches ${who(f)} at address ${c.fetch.pc}.${c.squash?.ifid ? ' (It will be flushed: see the Branch step.)' : ` At the next edge: PC ← ${c.next.pc}, IF/ID ← this instruction.`}`, tone: c.squash?.ifid ? 'flush' : undefined, at: 'imem', label: `address ${c.fetch.pc}` })
  else lines.push({ text: 'IF: there are no more instructions to fetch.', tone: 'muted' })
  lines[lines.length - 1].stage = 'IF'
  const title = stalled ? (h.branch?.stall ? 'Second half: branch operands not ready, stall' : 'Second half: hazard detected, stall') : 'Second half: ID reads registers · hazard check · IF fetches'
  return { title, tone: stalled ? 'hazard' : 'normal', lines }
}

function cond(k: FwdCheck, field: string, reg: number): Check[] {
  if (!k.present) return [{ text: `${k.from} is empty`, ok: false }]
  return [
    { text: `${k.from}.RegWrite = ${k.regWrite}`, ok: !!k.regWrite },
    { text: `${k.from}.RegisterRd (${regName(k.rd)}) ≠ 0`, ok: k.nonZero },
    { text: `${k.from}.RegisterRd (${regName(k.rd)}) = ${field} (${regName(reg)})`, ok: k.match },
  ]
}

function forwardLines(f: Fwd, c: Cycle): Line[] {
  const name = f.field === 'Rs' ? 'ForwardA' : 'ForwardB'
  const at: Unit = f.field === 'Rs' ? 'muxA' : 'muxB'
  const lines: Line[] = []
  const src = f.sel === '10' ? c.at.exmem! : f.sel === '01' ? c.at.memwb! : null
  lines.push({ text: `**${name}** (ALU input ${f.field === 'Rs' ? 'A' : 'B'}, ID/EX.Register${f.field} = ${regName(f.reg)}). EX hazard, slide 61:`, checks: cond(f.ex, `ID/EX.Register${f.field}`, f.reg), result: f.ex.holds ? `${name} = 10` : 'false', at })
  lines.push({ text: `MEM hazard, slide 64 (only if the EX hazard is false):`, checks: [...cond(f.mem, `ID/EX.Register${f.field}`, f.reg), { text: 'not EX hazard', ok: !f.ex.holds }], result: !f.ex.holds && f.mem.holds ? `${name} = 01` : 'false', at })
  if (f.sel === '10') lines.push({ text: `→ **${name} = 10**: the value ${f.value} comes from EX/MEM: the ALU result of ${who(src!.instr)}, which is now in MEM.`, tone: 'ex', at })
  else if (f.sel === '01') lines.push({ text: `→ **${name} = 01**: the value ${f.value} comes from MEM/WB: ${src!.ctrl.MemtoReg ? 'the data loaded by ' : 'the ALU result of '}${who(src!.instr)}, which is now in WB.`, tone: 'mem', at })
  else lines.push({ text: `→ ${name} = 00: the value ${f.value} read from the register file in ID is used.`, at, label: `${name} = 00` })
  if (f.double) lines.push({ text: `**Double data hazard** (slides 62–64): MEM/WB also holds a new ${regName(f.reg)} (${c.wb!.value}), but it is older. The revised MEM condition rejects it, and the newest value ${f.value} from EX/MEM wins.`, tone: 'ex', at: 'fu' })
  if (f.unused && f.sel !== '00') lines.push({ text: `Rt of ${q(c.at.idex!.instr)} is its destination, not a source. The forwarding unit still matches the number, but ALUSrc = 1 chooses the immediate, so the forwarded value is not used.`, tone: 'muted', at: 'aluSrc' })
  return lines
}

function aluText(op: string, a: number, b: number) {
  if (op === 'slt') return `(${a} < ${b} ? 1 : 0)`
  if (op === 'nor') return `NOT(${a} OR ${b})`
  const sym: Record<string, string> = { add: '+', sub: '−', and: 'AND', or: 'OR' }
  return `${a} ${sym[op]} ${b < 0 && op !== 'and' && op !== 'or' ? `(${b})` : b}`
}

function execute(sim: Simulation, c: Cycle): Explanation {
  const lines: Line[] = []
  const e = c.at.idex
  let forwarded = false
  if (e?.squashed) {
    lines.push({ text: `EX holds ${slot(e)}. ${e.bubble ? 'Its controls are 0' : 'It is a nop'}: nothing it computes is ever stored.`, tone: 'muted' })
  } else if (e?.bubble) {
    lines.push({ text: `EX holds the **bubble**. The forwarding unit and the ALU still work on the leftover fields of ${q(e.instr)}, but all its controls are 0: RegWrite = MemRead = MemWrite = 0, so the result is never stored or written anywhere.`, tone: 'muted' })
  } else if (e && c.ex && isBranch(e.instr.op) && sim.hw.branch === 'id') {
    lines.push({ text: `${who(e.instr)} was already decided in ID. In EX, MEM and WB it does nothing: RegWrite = MemRead = MemWrite = 0.`, tone: 'muted' })
  } else if (e && c.ex) {
    const x = c.ex
    lines.push(...forwardLines(x.fa, c))
    if (e.instr.op === 'sw' || !x.fb.unused) lines.push(...forwardLines(x.fb, c))
    else lines.push({ text: `ForwardB = ${x.fb.sel}${x.fb.unused && x.fb.sel !== '00' ? ' (not used)' : ''}: ${q(e.instr)} has no rt source. ALUSrc = 1 selects the immediate.`, tone: 'muted', at: 'aluSrc' })
    forwarded = x.fa.sel !== '00' || (x.fb.sel !== '00' && !x.fb.unused)
    lines.push({ text: `ALUSrc = ${e.ctrl.ALUSrc}: ALU input B = ${e.ctrl.ALUSrc ? `the sign-extended immediate ${e.imm}` : `the ForwardB mux output ${x.fb.value}`}. ALU control (ALUOp = ${e.ctrl.ALUOp.toString(2).padStart(2, '0')}${e.ctrl.ALUOp === 2 ? `, funct = ${(e.imm & 63).toString(2).padStart(6, '0')}` : ''}) → **${x.aluCtl.name}**: ${aluText(x.aluCtl.name, x.aluA, x.aluB)} = **${x.result}**.`, at: 'alu', label: `${aluText(x.aluCtl.name, x.aluA, x.aluB)} = ${x.result}` })
    if (isBranch(e.instr.op)) {
      lines.push({ text: `Branch in EX (Fig. 4.51): **Zero = ${x.zero}** (${x.aluA} ${x.zero ? '=' : '≠'} ${x.aluB}). The branch adder computes PC + 4 + offset × 4 = ${e.pc4} + ${e.imm} × 4 = **${x.target}** (shift left 2 then add). Both go into EX/MEM; the decision is made in MEM next cycle.`, tone: 'branch' })
      lines.push({ text: `Meanwhile two more instructions have entered behind the branch (in ID and IF).`, tone: 'muted' })
    }
    if (e.ctrl.MemWrite) lines.push({ text: `Store data: the ForwardB mux output (${x.writeData}) goes into EX/MEM as the data memory write data.`, at: 'exmem' })
    if (e.ctrl.RegWrite) lines.push({ text: `RegDst = ${e.ctrl.RegDst}: the destination is ${e.ctrl.RegDst ? 'Rd' : 'Rt'} = ${regName(x.regDst)}. It travels on as EX/MEM.RegisterRd.`, tone: 'muted', at: 'regDst', label: `RegDst = ${e.ctrl.RegDst} → ${regName(x.regDst)}` })
  }
  const m = c.at.exmem
  if (m?.squashed) lines.push({ text: `MEM holds ${slot(m)}: memory is not touched.`, tone: 'muted' })
  else if (m?.bubble) lines.push({ text: 'MEM holds the bubble: MemRead = MemWrite = 0, so memory is not touched.', tone: 'muted' })
  else if (m && c.mem?.read) lines.push({ text: `MEM: ${who(m.instr)} reads Mem[${c.mem.address}] = **${c.mem.readData}**. It goes into MEM/WB at the next edge, and from there it can be forwarded (01) to the instruction in EX.`, tone: 'mem', at: 'dmem', label: `read ${c.mem.readData}` })
  else if (m && c.mem?.write) lines.push({ text: `MEM: ${who(m.instr)} writes **${m.writeData}** to Mem[${c.mem.address}] at the end of this cycle.`, tone: 'mem', at: 'dmem', label: `Mem[${c.mem.address}] ← ${m.writeData}` })
  else if (m && isBranch(m.instr.op) && sim.hw.branch === 'mem') lines.push({ text: `MEM: ${who(m.instr)} does not access memory, but this is where it is decided. See the **Branch** step.`, tone: 'branch' })
  else if (m) lines.push({ text: `MEM: ${who(m.instr)} does not access memory. Its ALU result ${m.aluResult} goes to MEM/WB.`, tone: 'muted' })
  if (m) lines[lines.length - 1].stage = 'MEM'
  return { title: forwarded ? 'EX + MEM: forwarding in action' : 'EX + MEM: ALU and data memory', tone: forwarded ? 'forward' : 'normal', lines }
}

function cmpLines(f: CmpFwd): Line {
  const name = f.field === 'Rs' ? 'Comparator input 1 (ForwardC)' : 'Comparator input 2 (ForwardD)'
  return {
    text: `${name} (IF/ID.Register${f.field} = ${regName(f.reg)}): forward from EX/MEM? (slide 79)`,
    checks: cond(f.check, `IF/ID.Register${f.field}`, f.reg),
    result: f.sel ? `forward ${f.value}` : 'false',
    tone: f.sel ? 'ex' : undefined,
  }
}

function branchStep(sim: Simulation, c: Cycle): Explanation {
  const b = c.branch
  const lines: Line[] = []
  const policy = sim.hw.policy ?? 'predict'
  if (!b) {
    // Waiting (stall on branch) while the branch travels to MEM.
    const p = [c.at.ifid, c.at.idex, c.at.exmem].find((x) => x && !x.squashed && !('bubble' in x && x.bubble) && isBranch(x.instr.op))!
    const where = p === c.at.ifid ? 'ID' : p === c.at.idex ? 'EX' : 'MEM'
    lines.push({ text: `${who(p.instr)} is in **${where}** and is decided only in MEM. **Stall on branch**: the pipeline does not guess.`, tone: 'flush' })
    if (c.fetch.instr) lines.push({ text: `IF fetched ${who(c.fetch.instr)}, but it might be the wrong instruction. At the next edge IF.Flush throws it away (IF/ID ← nop) and the PC stays at ${c.next.pc}.`, tone: 'flush' })
    return { title: `Branch: waiting for ${p.instr.text} (stall on branch)`, tone: 'flush', lines }
  }
  const i = b.instr
  const cond_ = i.op === 'beq' ? 'equal' : 'not equal'
  if (b.at === 'id') {
    lines.push({ text: `Target adder in ID (slide 78): PC + 4 + offset × 4 = ${b.pc4} + ${i.imm} × 4 = **${b.target}**. The offset is shifted left 2 because it counts words.`, tone: 'branch' })
    lines.push(cmpLines(b.fa!), cmpLines(b.fb!))
    lines.push({ text: `Comparator: ${b.a} ${b.equal ? '=' : '≠'} ${b.b} → Equal = ${+b.equal}. ${q(i)} branches if the registers are ${cond_}: **${b.taken ? 'taken' : 'not taken'}**.`, tone: 'branch' })
    lines.push({ text: `PCSrc = Branch AND ${i.op === 'beq' ? 'Equal' : 'NOT Equal'} = ${+b.taken}.`, tone: b.taken ? 'branch' : undefined })
  } else {
    lines.push({ text: `MEM (slide 77, Fig. 4.51): EX/MEM.Branch = 1, EX/MEM.Zero = ${+b.equal} (computed in EX last cycle). PCSrc = Branch AND ${i.op === 'beq' ? 'Zero' : 'NOT Zero'} = **${+b.taken}**: ${b.taken ? 'taken' : 'not taken'}.`, tone: 'branch' })
  }
  if (policy === 'stall') {
    if (c.fetch.instr) lines.push({ text: `Stall on branch: the instruction IF fetched this cycle (${who(c.fetch.instr)}) is thrown away anyway.`, tone: 'flush' })
    lines.push({ text: b.taken ? `At the next edge **PC ← ${b.target}** (the target).` : `At the next edge **PC ← ${b.pc4}** (the instruction after the branch, fetched now that we know).`, tone: 'branch' })
    const lost = sim.hw.branch === 'mem' ? 3 : 1
    lines.push({ text: `Cost: ${lost} cycle${lost > 1 ? 's' : ''} lost on every branch, taken or not (slide ${sim.hw.branch === 'mem' ? 26 : 27}).`, tone: 'muted' })
    return { title: `Branch decided in ${b.at.toUpperCase()}: ${b.taken ? 'taken' : 'not taken'}`, tone: 'branch', lines }
  }
  if (!b.taken) {
    lines.push({ text: `Not taken, so the guess (**predict not taken**, slide 29) was right. The instructions already fetched after the branch are the correct ones. Nothing is flushed, no cycle lost.`, tone: 'branch' })
    return { title: `Branch decided in ${b.at.toUpperCase()}: not taken, prediction correct`, tone: 'branch', lines }
  }
  if (policy === 'delayed') {
    lines.push({ text: `At the next edge **PC ← ${b.target}**. **Delayed branch** (slide 31): the instruction right after the branch, ${c.fetch.instr ? who(c.fetch.instr) : 'the delay slot'}, is in the delay slot and runs anyway. Nothing is flushed. The compiler must put an instruction there that is correct on both paths (or a nop).`, tone: 'branch' })
    return { title: 'Branch decided in ID: taken, delay slot runs', tone: 'branch', lines }
  }
  lines.push({ text: `Taken, but IF kept fetching in order (predict not taken). At the next edge **PC ← ${b.target}**, and what came in after the branch is on the wrong path:`, tone: 'flush' })
  const s = c.squash!
  if (s.ifid && c.fetch.instr) lines.push({ text: `**IF.Flush = 1**: ${who(c.fetch.instr)} (in IF) becomes a nop in IF/ID.`, tone: 'flush' })
  if (b.at === 'mem') {
    const d = c.at.ifid, e = c.at.idex
    if (d) lines.push({ text: `**ID.Flush = 1**: ${slot(d)} (in ID) gets all-zero controls in ID/EX.`, tone: 'flush' })
    if (e) lines.push({ text: `**EX.Flush = 1**: ${slot(e)} (in EX) gets all-zero controls in EX/MEM.`, tone: 'flush' })
    if (c.hazard.overridden) lines.push({ text: `The hazard detection unit asked for a stall this cycle, but the flush wins: the stalled instruction is on the wrong path anyway.`, tone: 'muted' })
  }
  const lost = (b.at === 'mem' ? 3 : 1)
  lines.push({ text: `None of them wrote anything yet: registers and memory are written only in MEM and WB, so throwing them away is safe. Cost: **${lost} cycle${lost > 1 ? 's' : ''}** lost (slide ${b.at === 'mem' ? 77 : 78}).`, tone: 'muted' })
  return { title: `Branch decided in ${b.at.toUpperCase()}: taken → flush ${lost}`, tone: 'flush', lines }
}

export function explain(sim: Simulation, step: Step): Explanation {
  const c = sim.cycles[step.cycle]
  if (step.phase === 'edge') return edge(sim, step.cycle)
  if (step.phase === 'wb') return writeBack(c)
  if (step.phase === 'id') return decode(sim, c)
  if (step.phase === 'br') return branchStep(sim, c)
  if (step.phase === 'all') { const w = wholeCycle(sim, step.cycle); return { title: w.title, tone: w.tone, lines: w.edge } }
  return execute(sim, c)
}

// ---------- the whole cycle at once ----------

/** One stage's share of a cycle: who is in it, short badges and the explanation lines. */
export type StageCard = { stage: Stage; instr: Instr | null; bubble: boolean; gone?: Squash; when: string; badges: { text: string; tone: Line['tone'] }[]; lines: Line[] }
export type WholeCycle = { title: string; tone: Explanation['tone']; edge: Line[]; cards: StageCard[]; branch: Explanation | null }

export function wholeCycle(sim: Simulation, k: number): WholeCycle {
  const c = sim.cycles[k]
  const dec = c.at.ifid || c.fetch.instr ? decode(sim, c).lines : []
  const exe = c.at.idex || c.at.exmem ? execute(sim, c).lines : []
  const wbl = c.at.memwb ? writeBack(c).lines : []
  const stalled = c.hazard.stall && !c.hazard.overridden
  const b = c.branch
  const e = c.at.idex
  const fwd = c.ex && e && !e.bubble && !e.squashed && !(isBranch(e.instr.op) && sim.hw.branch === 'id') ? [c.ex.fa, c.ex.fb].filter((f) => f.sel !== '00' && !(f.unused && e.instr.op !== 'sw')) : []
  const cmp = b?.at === 'id' ? [b.fa!, b.fb!].filter((f) => f.sel === 1) : []
  const pkt = (p: { instr: Instr; bubble?: boolean; squashed?: Squash } | null) => ({ instr: p ? (p.squashed?.instr ?? p.instr) : null, bubble: !!p?.bubble && !p.squashed, gone: p?.squashed })
  const badge = (text: string, tone: Line['tone']) => ({ text, tone })
  const cards: StageCard[] = [
    {
      stage: 'IF', instr: c.fetch.instr, bubble: false, when: 'whole cycle', lines: dec.filter((l) => l.stage === 'IF'),
      badges: [
        ...(c.fetch.instr ? [badge(`address ${c.fetch.pc}`, 'muted')] : []),
        ...(stalled && c.fetch.instr ? [badge('fetched again next cycle', 'hazard')] : []),
        ...(c.squash?.ifid ? [badge(c.squash.why === 'flush' ? 'flushed at the edge' : 'thrown away', 'flush')] : []),
      ],
    },
    {
      stage: 'ID', ...pkt(c.at.ifid), when: 'whole cycle · reads registers in the 2nd half', lines: c.at.ifid ? dec.filter((l) => l.stage !== 'IF') : [],
      badges: [
        ...(stalled ? [badge(c.hazard.branch?.stall && !c.hazard.loadUse ? 'branch stall' : 'STALL', 'hazard')] : []),
        ...(c.hazard.overridden ? [badge('stall overridden by flush', 'flush')] : []),
        ...(c.id && !c.at.ifid?.squashed && (c.id.sameCycleRs || c.id.sameCycleRt) ? [badge('reads the value written in the 1st half', 'rf')] : []),
        ...(b?.at === 'id' ? [badge(b.taken ? `taken → ${b.target}` : 'not taken', 'branch')] : []),
        ...cmp.map((f) => badge(`${f.field === 'Rs' ? 'ForwardC' : 'ForwardD'} = 1`, 'ex')),
        ...(c.squash?.idex ? [badge('ID.Flush', 'flush')] : []),
      ],
    },
    {
      stage: 'EX', ...pkt(e), when: 'whole cycle', lines: exe.filter((l) => l.stage !== 'MEM'),
      badges: [
        ...fwd.map((f) => badge(`${f.field === 'Rs' ? 'ForwardA' : 'ForwardB'} = ${f.sel}`, f.sel === '10' ? 'ex' : 'mem')),
        ...(c.ex && e && !e.bubble && !e.squashed ? [badge(`${c.ex.aluCtl.name} = ${c.ex.result}`, 'muted')] : []),
        ...(c.squash?.exmem ? [badge('EX.Flush', 'flush')] : []),
      ],
    },
    {
      stage: 'MEM', ...pkt(c.at.exmem), when: 'whole cycle · a store is written at the end', lines: exe.filter((l) => l.stage === 'MEM'),
      badges: [
        ...(c.mem?.read ? [badge(`read Mem[${c.mem.address}] = ${c.mem.readData}`, 'mem')] : []),
        ...(c.mem?.write ? [badge(`Mem[${c.mem.address}] ← ${c.at.exmem!.writeData}`, 'mem')] : []),
        ...(b?.at === 'mem' ? [badge(b.taken ? `taken → ${b.target}` : 'not taken', 'branch')] : []),
      ],
    },
    {
      stage: 'WB', ...pkt(c.at.memwb), when: '1st half: writes the register file', lines: wbl,
      badges: c.wb?.writes ? [badge(`${regName(c.wb.rd)} ← ${c.wb.value}`, 'rf')] : [],
    },
  ]
  const bits: string[] = []
  let tone: Explanation['tone'] = 'normal'
  const note = (t: string, tn: Explanation['tone']) => { bits.push(t); if (tone === 'normal') tone = tn }
  if (b?.taken && c.squash?.why === 'flush') note(`branch taken → flush ${+c.squash.ifid + +c.squash.idex + +c.squash.exmem}`, 'flush')
  else if (b) note(`branch ${b.taken ? 'taken' : 'not taken'}`, 'branch')
  if (c.waiting) note('waiting for a branch', 'flush')
  if (stalled) note(c.hazard.branch?.stall && !c.hazard.loadUse ? 'branch stall' : 'load-use stall', 'hazard')
  for (const f of fwd) note(`${f.field === 'Rs' ? 'ForwardA' : 'ForwardB'} = ${f.sel}`, 'forward')
  for (const f of cmp) note(`${f.field === 'Rs' ? 'ForwardC' : 'ForwardD'} = 1`, 'forward')
  if (c.wb?.writes) note(`${regName(c.wb.rd)} written`, 'rf')
  const title = bits.length ? bits.join(' · ') : 'every stage works in parallel'
  return { title, tone, edge: edge(sim, k).lines, cards, branch: b || c.waiting ? branchStep(sim, c) : null }
}
