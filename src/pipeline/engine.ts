// Cycle-accurate model of the five-stage pipeline of Chapter 4 Part 2, slide 75
// (slide 52's datapath and control + slide 65's forwarding unit + slide 75's hazard
// detection unit). Every rule is the slide's rule, nothing smarter:
//  - forwarding unit: slide 61 EX hazard, slide 64 revised MEM hazard
//  - hazard detection: slide 69, ID/EX.MemRead and ID/EX.RegisterRt = IF/ID.RegisterRs or IF/ID.RegisterRt
//  - stall: slide 72, zero the ID/EX control fields, PCWrite = 0, IF/IDWrite = 0
//  - register file: write in the first half, read in the second half (slide 55)
// Branches and jumps are not part of this lesson yet.

export const NAMES = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra']
// Registers are shown the way the loaded program writes them: $2 style (as on the slides) or $t0 style.
let numericNames = false
export const regName = (n: number) => (numericNames ? `$${n}` : `$${NAMES[n]}`)
export const hex = (n: number, digits = 8) => `0x${(n >>> 0).toString(16).padStart(digits, '0')}`
export const bits = (n: number, width: number) => (n >>> 0).toString(2).padStart(width, '0').slice(-width)

export type Op = 'add' | 'sub' | 'and' | 'or' | 'slt' | 'nor' | 'addi' | 'lw' | 'sw' | 'nop'
const FUNCT: Partial<Record<Op, number>> = { add: 0x20, sub: 0x22, and: 0x24, or: 0x25, slt: 0x2a, nor: 0x27, nop: 0 }
const OPCODE: Partial<Record<Op, number>> = { addi: 0x08, lw: 0x23, sw: 0x2b }
const R_OPS: Op[] = ['add', 'sub', 'and', 'or', 'slt', 'nor']

/** One instruction with the raw fields the hardware sees (rd is bits 15–11 even for I-format). */
export type Instr = { id: number; line: number; text: string; op: Op; rs: number; rt: number; rd: number; imm: number; word: number }

// ---------- parsing ----------

export function register(s: string): number {
  const t = s.trim()
  const name = t.toLowerCase().replace(/^\$/, '')
  const n = /^\d+$/.test(name) ? Number(name) : name === 's8' ? 30 : NAMES.indexOf(name)
  if (!t.startsWith('$') || n < 0 || n > 31) throw new Error(`"${t}" is not a register. Use $0–$31 or a name such as $t0.`)
  return n
}

function integer(s: string, min: number, max: number) {
  const t = s.trim()
  if (!/^-?(?:0x[\da-f]+|\d+)$/i.test(t)) throw new Error(`"${t}" is not a number.`)
  const n = t.startsWith('-') ? -Number(t.slice(1)) : Number(t)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${t} must be between ${min} and ${max}.`)
  return n
}

function encode(i: Omit<Instr, 'word' | 'rd'> & { rd?: number }): number {
  if (i.op === 'nop') return 0
  const f = FUNCT[i.op]
  if (f !== undefined) return ((i.rs << 21) | (i.rt << 16) | ((i.rd ?? 0) << 11) | f) >>> 0
  return ((OPCODE[i.op]! << 26) | (i.rs << 21) | (i.rt << 16) | (i.imm & 0xffff)) >>> 0
}

const UNSUPPORTED: Record<string, string> = {
  beq: 'Branches are the next lesson (control hazards). This lab covers data hazards only.',
  bne: 'Branches are the next lesson (control hazards). This lab covers data hazards only.',
  j: 'Jumps are the next lesson (control hazards). This lab covers data hazards only.',
  jal: 'Jumps are the next lesson (control hazards). This lab covers data hazards only.',
  jr: 'Jumps are the next lesson (control hazards). This lab covers data hazards only.',
}

export const MAX_INSTRUCTIONS = 24

export function parseProgram(code: string): Instr[] {
  const out: Instr[] = []
  code.split('\n').forEach((raw, index) => {
    const text = raw.replace(/#.*/, '').trim()
    if (!text) return
    try {
      if (/^\w+:/.test(text)) throw new Error('Labels are only needed for branches, which come in the next lesson.')
      const m = text.match(/^(\w+)\s*(.*)$/)!
      const op = m[1].toLowerCase()
      const args = m[2] ? m[2].split(',').map((a) => a.trim()) : []
      const need = (n: number, form: string) => {
        if (args.length !== n || args.some((a) => !a)) throw new Error(`Write it as: ${op} ${form}`)
      }
      let ins: Omit<Instr, 'word' | 'rd'> & { rd?: number }
      if ((R_OPS as string[]).includes(op)) {
        need(3, '$rd, $rs, $rt')
        ins = { id: out.length, line: index + 1, text, op: op as Op, rd: register(args[0]), rs: register(args[1]), rt: register(args[2]), imm: 0 }
        ins.imm = (ins.rd! << 11) | FUNCT[op as Op]!
      } else if (op === 'addi') {
        need(3, '$rt, $rs, immediate')
        ins = { id: out.length, line: index + 1, text, op, rt: register(args[0]), rs: register(args[1]), imm: integer(args[2], -32768, 32767) }
      } else if (op === 'lw' || op === 'sw') {
        need(2, '$rt, offset($rs)')
        const mm = args[1].match(/^(-?(?:0x[\da-f]+|\d+))?\s*\((\$\w+)\)$/i)
        if (!mm) throw new Error(`Write the address as offset($register), e.g. ${op} $t0, 8($s1)`)
        ins = { id: out.length, line: index + 1, text, op, rt: register(args[0]), rs: register(mm[2]), imm: integer(mm[1] ?? '0', -32768, 32767) }
      } else if (op === 'nop') {
        if (args.length) throw new Error('nop takes no operands.')
        ins = { id: out.length, line: index + 1, text: 'nop', op, rs: 0, rt: 0, rd: 0, imm: 0 }
      } else if (UNSUPPORTED[op]) {
        throw new Error(UNSUPPORTED[op])
      } else {
        throw new Error(`"${op}" is not in the slide datapath. Use add, sub, and, or, slt, nor, addi, lw, sw or nop.`)
      }
      const word = encode(ins)
      // The immediate field holds rd and funct for R-format; the ID stage sign-extends it like any other.
      const imm16 = word & 0xffff
      out.push({ ...ins, rd: (word >>> 11) & 31, imm: (imm16 << 16) >> 16, word })
    } catch (e) {
      throw new Error(`Line ${index + 1}: ${(e as Error).message}`)
    }
  })
  if (!out.length) throw new Error('Type at least one instruction.')
  if (out.length > MAX_INSTRUCTIONS) throw new Error(`Use at most ${MAX_INSTRUCTIONS} instructions so the trace stays readable.`)
  return out
}

export function parseInitial(registerText: string, memoryText: string) {
  const regs = Array<number>(32).fill(0)
  const memory: Record<number, number> = {}
  const each = (text: string, fn: (key: string, value: number) => void) =>
    text.split(/[\n,]/).forEach((line) => {
      const clean = line.replace(/#.*/, '').trim()
      if (!clean) return
      const parts = clean.split('=').map((s) => s.trim())
      if (parts.length !== 2) throw new Error(`Write each value as name = value (got "${clean}").`)
      fn(parts[0], integer(parts[1], -2147483648, 4294967295) | 0)
    })
  each(registerText, (key, value) => {
    const r = register(key)
    if (r === 0 && value !== 0) throw new Error('$zero is always 0.')
    regs[r] = value
  })
  each(memoryText, (key, value) => {
    const address = integer(key, 0, 4294967295)
    if (address % 4) throw new Error(`Memory address ${key} is not a multiple of 4.`)
    memory[address] = value
  })
  return { regs, memory }
}

// ---------- control (slide 51) ----------

/** Control bits grouped as they sit in the pipeline registers: EX, M, WB. */
export type Controls = { RegDst: number; ALUOp: number; ALUSrc: number; MemRead: number; MemWrite: number; RegWrite: number; MemtoReg: number }
export const ZERO_CONTROLS: Controls = { RegDst: 0, ALUOp: 0, ALUSrc: 0, MemRead: 0, MemWrite: 0, RegWrite: 0, MemtoReg: 0 }

export function control(op: Op): Controls {
  if (op === 'lw') return { RegDst: 0, ALUOp: 0b00, ALUSrc: 1, MemRead: 1, MemWrite: 0, RegWrite: 1, MemtoReg: 1 }
  if (op === 'sw') return { RegDst: 0, ALUOp: 0b00, ALUSrc: 1, MemRead: 0, MemWrite: 1, RegWrite: 0, MemtoReg: 0 }
  if (op === 'addi') return { RegDst: 0, ALUOp: 0b00, ALUSrc: 1, MemRead: 0, MemWrite: 0, RegWrite: 1, MemtoReg: 0 }
  // R-format, including nop = sll $0,$0,0 (it writes $zero, which the register file ignores)
  return { RegDst: 1, ALUOp: 0b10, ALUSrc: 0, MemRead: 0, MemWrite: 0, RegWrite: 1, MemtoReg: 0 }
}
/** Signals that are X (don't care) for an op; drawn as X but stored as 0. */
export const dontCare = (op: Op | undefined): (keyof Controls)[] => (op === 'sw' ? ['RegDst', 'MemtoReg'] : [])

/** ALU control (slide 4.13 table): ALUOp 00 → add, 10 → from funct[3:0]. */
export function aluControl(aluOp: number, funct: number): { code: number; name: string } {
  if (aluOp !== 0b10) return { code: 0b0010, name: 'add' }
  switch (funct & 0xf) {
    case 0b0010: return { code: 0b0110, name: 'sub' }
    case 0b0100: return { code: 0b0000, name: 'and' }
    case 0b0101: return { code: 0b0001, name: 'or' }
    case 0b1010: return { code: 0b0111, name: 'slt' }
    case 0b0111: return { code: 0b1100, name: 'nor' }
    default: return { code: 0b0010, name: 'add' }
  }
}
function alu(code: number, a: number, b: number) {
  switch (code) {
    case 0b0000: return a & b
    case 0b0001: return a | b
    case 0b0110: return (a - b) | 0
    case 0b0111: return a < b ? 1 : 0
    case 0b1100: return ~(a | b)
    default: return (a + b) | 0
  }
}

// ---------- pipeline registers ----------

/** IF/ID: the fetched instruction word and PC + 4. */
export type IFID = { instr: Instr; pc4: number }
/** ID/EX. A bubble keeps the data fields of the stalled instruction but all its controls are 0 (slide 71). */
export type IDEX = { instr: Instr; bubble: boolean; ctrl: Controls; pc4: number; data1: number; data2: number; imm: number; rs: number; rt: number; rd: number }
export type EXMEM = { instr: Instr; bubble: boolean; ctrl: Controls; aluResult: number; writeData: number; regRd: number }
export type MEMWB = { instr: Instr; bubble: boolean; ctrl: Controls; readData: number; aluResult: number; regRd: number }
export type Latches = { pc: number; ifid: IFID | null; idex: IDEX | null; exmem: EXMEM | null; memwb: MEMWB | null }

// ---------- what each stage does in a cycle ----------

/** One term of a forwarding condition, as written on slides 61/64. */
export type FwdCheck = { from: 'EX/MEM' | 'MEM/WB'; present: boolean; regWrite: number; rd: number; nonZero: boolean; match: boolean; holds: boolean }
export type Fwd = { sel: '00' | '10' | '01'; reg: number; field: 'Rs' | 'Rt'; value: number; ex: FwdCheck; mem: FwdCheck; double: boolean; unused: boolean }

export type Hazard = { checked: boolean; memRead: number; idexRt: number; ifidRs: number; ifidRt: number; matchRs: boolean; matchRt: boolean; stall: boolean; conservative: boolean }

export type Cycle = {
  n: number
  /** Pipeline state latched at the rising edge that starts this cycle. */
  at: Latches
  regs: number[] // register file at the start of the cycle
  regsMid: number[] // after the first-half write
  memory: Record<number, number> // data memory during the cycle (stores land at the next edge)
  fetch: { instr: Instr | null; pc: number; pc4: number }
  wb: { value: number; regWrite: number; memtoReg: number; rd: number; writes: boolean; old: number } | null
  id: { instr: Instr; data1: number; data2: number; ctrl: Controls; ctrlOut: Controls; sameCycleRs: boolean; sameCycleRt: boolean } | null
  hazard: Hazard
  ex: { fa: Fwd; fb: Fwd; aluA: number; aluB: number; aluCtl: { code: number; name: string }; result: number; regDst: number; writeData: number } | null
  mem: { address: number; read: boolean; write: boolean; readData: number; old: number } | null
  pcWrite: number
  ifidWrite: number
  next: Latches
}

export type Simulation = { program: Instr[]; cycles: Cycle[]; final: { regs: number[]; memory: Record<number, number> }; stalls: number }

function fwdCheck(from: FwdCheck['from'], p: EXMEM | MEMWB | null, reg: number): FwdCheck {
  if (!p) return { from, present: false, regWrite: 0, rd: 0, nonZero: false, match: false, holds: false }
  const regWrite = p.ctrl.RegWrite, rd = p.regRd
  const nonZero = rd !== 0, match = rd === reg
  return { from, present: true, regWrite, rd, nonZero, match, holds: !!regWrite && nonZero && match }
}

const usesRt = (op: Op) => (R_OPS as string[]).includes(op) || op === 'sw'

function forward(field: 'Rs' | 'Rt', idex: IDEX, exmem: EXMEM | null, memwb: MEMWB | null, wbValue: number): Fwd {
  const reg = field === 'Rs' ? idex.rs : idex.rt
  const original = field === 'Rs' ? idex.data1 : idex.data2
  const ex = fwdCheck('EX/MEM', exmem, reg)
  const mem = fwdCheck('MEM/WB', memwb, reg)
  // Slide 64: forward from MEM/WB only if the EX hazard is not true.
  const sel = ex.holds ? '10' : mem.holds ? '01' : '00'
  const value = sel === '10' ? exmem!.aluResult : sel === '01' ? wbValue : original
  // ForwardB still fires for addi/lw, whose rt is a destination; ALUSrc = 1 then ignores it.
  const unused = field === 'Rt' && !usesRt(idex.instr.op)
  return { sel, reg, field, value, ex, mem, double: ex.holds && mem.holds, unused }
}

export function simulate(program: Instr[], regs0: number[], memory0: Record<number, number>): Simulation {
  let at: Latches = { pc: 0, ifid: null, idex: null, exmem: null, memwb: null }
  let regs = [...regs0]
  regs[0] = 0
  let memory = { ...memory0 }
  const cycles: Cycle[] = []
  let stalls = 0
  const limit = program.length * 3 + 10
  for (let n = 1; at.pc / 4 < program.length || at.ifid || at.idex || at.exmem || at.memwb; n++) {
    if (n > limit) throw new Error('The simulation did not finish.')
    const { ifid, idex, exmem, memwb } = at

    // WB, first half: the register file is written.
    const regsMid = [...regs]
    let wb: Cycle['wb'] = null
    if (memwb) {
      const value = memwb.ctrl.MemtoReg ? memwb.readData : memwb.aluResult
      const writes = !!memwb.ctrl.RegWrite && memwb.regRd !== 0
      if (writes) regsMid[memwb.regRd] = value
      wb = { value, regWrite: memwb.ctrl.RegWrite, memtoReg: memwb.ctrl.MemtoReg, rd: memwb.regRd, writes, old: regs[memwb.regRd] }
    }
    const wbValue = wb?.value ?? 0

    // ID, second half: read the register file; the hazard detection unit compares register numbers.
    let id: Cycle['id'] = null
    const hazard: Hazard = { checked: false, memRead: 0, idexRt: 0, ifidRs: 0, ifidRt: 0, matchRs: false, matchRt: false, stall: false, conservative: false }
    if (ifid) {
      const i = ifid.instr
      hazard.checked = !!idex
      hazard.ifidRs = i.rs
      hazard.ifidRt = i.rt
      if (idex) {
        hazard.memRead = idex.ctrl.MemRead
        hazard.idexRt = idex.rt
        hazard.matchRs = idex.rt === i.rs
        hazard.matchRt = idex.rt === i.rt
        hazard.stall = !!idex.ctrl.MemRead && (hazard.matchRs || hazard.matchRt)
        // The slide-69 unit compares numbers only: it also stalls when rt is merely addi's or lw's destination.
        hazard.conservative = hazard.stall && !hazard.matchRs && !usesRt(i.op)
      }
      const ctrl = control(i.op)
      const sameCycle = (r: number) => !!wb?.writes && wb.rd === r
      id = { instr: i, data1: regsMid[i.rs], data2: regsMid[i.rt], ctrl, ctrlOut: hazard.stall ? ZERO_CONTROLS : ctrl, sameCycleRs: sameCycle(i.rs), sameCycleRt: sameCycle(i.rt) }
    }

    // EX: forwarding unit, ALU.
    let ex: Cycle['ex'] = null
    if (idex) {
      const fa = forward('Rs', idex, exmem, memwb, wbValue)
      const fb = forward('Rt', idex, exmem, memwb, wbValue)
      const aluB = idex.ctrl.ALUSrc ? idex.imm : fb.value
      const aluCtl = aluControl(idex.ctrl.ALUOp, idex.imm & 0x3f)
      ex = { fa, fb, aluA: fa.value, aluB, aluCtl, result: alu(aluCtl.code, fa.value, aluB), regDst: idex.ctrl.RegDst ? idex.rd : idex.rt, writeData: fb.value }
    }

    // MEM: data memory. A store is written at the end of the cycle.
    let mem: Cycle['mem'] = null
    if (exmem && (exmem.ctrl.MemRead || exmem.ctrl.MemWrite)) {
      const address = exmem.aluResult >>> 0
      if (address % 4) throw new Error(`Cycle ${n}: ${exmem.instr.text} uses address ${address}, which is not a multiple of 4.`)
      mem = { address, read: !!exmem.ctrl.MemRead, write: !!exmem.ctrl.MemWrite, readData: memory[address] ?? 0, old: memory[address] ?? 0 }
    }

    // IF
    const fetched = program[at.pc / 4] ?? null
    const fetch = { instr: fetched, pc: at.pc, pc4: at.pc + 4 }

    // Next rising edge.
    const stall = hazard.stall
    if (stall) stalls++
    const nextIdex: IDEX | null = ifid && id
      ? { instr: ifid.instr, bubble: stall, ctrl: id.ctrlOut, pc4: ifid.pc4, data1: id.data1, data2: id.data2, imm: ifid.instr.imm, rs: ifid.instr.rs, rt: ifid.instr.rt, rd: ifid.instr.rd }
      : null
    const next: Latches = {
      pc: stall || !fetched ? at.pc : at.pc + 4,
      ifid: stall ? ifid : fetched ? { instr: fetched, pc4: at.pc + 4 } : null,
      idex: nextIdex,
      exmem: idex && ex ? { instr: idex.instr, bubble: idex.bubble, ctrl: idex.ctrl, aluResult: ex.result, writeData: ex.writeData, regRd: ex.regDst } : null,
      memwb: exmem ? { instr: exmem.instr, bubble: exmem.bubble, ctrl: exmem.ctrl, readData: mem?.read ? mem.readData : 0, aluResult: exmem.aluResult, regRd: exmem.regRd } : null,
    }
    cycles.push({ n, at, regs, regsMid, memory, fetch, wb, id, hazard, ex, mem, pcWrite: stall ? 0 : 1, ifidWrite: stall ? 0 : 1, next })

    const nextMemory = { ...memory }
    if (mem?.write) nextMemory[mem.address] = exmem!.writeData
    memory = nextMemory
    regs = regsMid
    at = next
  }
  numericNames = program.some((i) => /\$\d/.test(i.text))
  return { program, cycles, final: { regs, memory }, stalls }
}

// ---------- what happened to each dependence (for the overview) ----------

export type Resolution =
  | { kind: 'exmem' | 'memwb'; cycle: number; double: boolean }
  | { kind: 'regfile-same'; cycle: number }
  | { kind: 'regfile' }

export type Dependence = { consumer: number; producer: number; reg: number; field: 'Rs' | 'Rt'; role: string; distance: number; resolution: Resolution; stalls: number }

/** Sources an instruction really reads (what a programmer would call a dependence). */
export function sources(i: Instr): { field: 'Rs' | 'Rt'; reg: number; role: string }[] {
  if (i.op === 'nop') return []
  if (i.op === 'addi') return [{ field: 'Rs', reg: i.rs, role: 'rs' }]
  if (i.op === 'lw') return [{ field: 'Rs', reg: i.rs, role: 'base address' }]
  if (i.op === 'sw') return [{ field: 'Rs', reg: i.rs, role: 'base address' }, { field: 'Rt', reg: i.rt, role: 'store data' }]
  return [{ field: 'Rs', reg: i.rs, role: 'rs' }, { field: 'Rt', reg: i.rt, role: 'rt' }]
}
export const destination = (i: Instr) => (control(i.op).RegWrite ? (control(i.op).RegDst ? i.rd : i.rt) : 0)

export function dependences(sim: Simulation): Dependence[] {
  const out: Dependence[] = []
  const exCycle = (id: number) => sim.cycles.find((c) => c.at.idex && !c.at.idex.bubble && c.at.idex.instr.id === id)
  const idCycles = (id: number) => sim.cycles.filter((c) => c.at.ifid?.instr.id === id)
  for (const ins of sim.program) {
    for (const s of sources(ins)) {
      if (s.reg === 0) continue
      let producer = -1
      for (let k = ins.id - 1; k >= 0; k--) if (destination(sim.program[k]) === s.reg) { producer = k; break }
      if (producer < 0) continue
      const c = exCycle(ins.id)!
      const f = s.field === 'Rs' ? c.ex!.fa : c.ex!.fb
      const reads = idCycles(ins.id)
      const lastRead = reads[reads.length - 1]
      let resolution: Resolution
      if (f.sel !== '00') resolution = { kind: f.sel === '10' ? 'exmem' : 'memwb', cycle: c.n, double: f.double }
      else if (lastRead && (s.field === 'Rs' ? lastRead.id!.sameCycleRs : lastRead.id!.sameCycleRt)) resolution = { kind: 'regfile-same', cycle: lastRead.n }
      else resolution = { kind: 'regfile' }
      out.push({ consumer: ins.id, producer, reg: s.reg, field: s.field, role: s.role, distance: ins.id - producer, resolution, stalls: reads.filter((r) => r.hazard.stall).length })
    }
  }
  return out
}
