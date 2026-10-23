// Cycle-accurate model of the five-stage pipeline of Chapter 4 Part 2, slide 75
// (slide 52's datapath and control + slide 65's forwarding unit + slide 75's hazard
// detection unit). Every rule is the slide's rule, nothing smarter:
//  - forwarding unit: slide 61 EX hazard, slide 64 revised MEM hazard
//  - hazard detection: slide 69, ID/EX.MemRead and ID/EX.RegisterRt = IF/ID.RegisterRs or IF/ID.RegisterRt
//  - stall: slide 72, zero the ID/EX control fields, PCWrite = 0, IF/IDWrite = 0
//  - register file: write in the first half, read in the second half (slide 55)
//
// Branches (beq, bne) exist only when a lesson asks for branch hardware (`Hardware.branch`):
//  - 'mem': slide 77 / Fig. 4.51. Target adder and Zero in EX, PCSrc = Branch AND Zero in MEM.
//    A taken branch flushes the three younger instructions (IF.Flush, ID.Flush, EX.Flush).
//  - 'id': slide 78 / Fig. 4.62. Target adder and register comparator in ID, IF.Flush on a taken branch.
//    The comparator gets EX/MEM.ALUResult forwarded (slide 79) and the hazard detection unit
//    stalls a branch whose register is still being computed (slides 80–81).
// and a policy for the instructions behind the branch:
//  - 'predict': predict not taken (slide 29), flush only when the branch is taken
//  - 'stall': stall on every branch until it is decided (slides 26–27)
//  - 'delayed': delayed branch (slide 31), the instruction after the branch always runs (ID only)

export const NAMES = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra']
// Registers are shown the way the loaded program writes them: $2 style (as on the slides) or $t0 style.
let numericNames = false
export const regName = (n: number) => (numericNames ? `$${n}` : `$${NAMES[n]}`)
export const hex = (n: number, digits = 8) => `0x${(n >>> 0).toString(16).padStart(digits, '0')}`
export const bits = (n: number, width: number) => (n >>> 0).toString(2).padStart(width, '0').slice(-width)

export type Op = 'add' | 'sub' | 'and' | 'or' | 'slt' | 'nor' | 'addi' | 'lw' | 'sw' | 'nop' | 'beq' | 'bne'
const FUNCT: Partial<Record<Op, number>> = { add: 0x20, sub: 0x22, and: 0x24, or: 0x25, slt: 0x2a, nor: 0x27, nop: 0 }
const OPCODE: Partial<Record<Op, number>> = { addi: 0x08, lw: 0x23, sw: 0x2b, beq: 0x04, bne: 0x05 }
const R_OPS: Op[] = ['add', 'sub', 'and', 'or', 'slt', 'nor']
export const isBranch = (op: Op | undefined) => op === 'beq' || op === 'bne'

/** One instruction with the raw fields the hardware sees (rd is bits 15–11 even for I-format).
 *  addr is its byte address; a branch also knows its target address and the label it was written with. */
export type Instr = { id: number; line: number; text: string; op: Op; rs: number; rt: number; rd: number; imm: number; word: number; addr: number; target?: number; labels?: string[]; filler?: boolean }

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

type Draft = Omit<Instr, 'word' | 'rd'> & { rd?: number }

function encode(i: Draft): number {
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
const NOT_IN_BRANCH_LAB: Record<string, string> = {
  j: 'The slide datapaths (Fig. 4.51 and 4.62) have no jump hardware. Use beq $0, $0, label for an unconditional branch.',
  jal: 'jal is not in the slide pipeline datapaths.',
  jr: 'jr is not in the slide pipeline datapaths.',
}

export const MAX_INSTRUCTIONS = 24
/** A branch lesson stops a program that runs longer than this (an endless loop). */
export const MAX_CYCLES = 160

export type ParseOptions = { branches?: boolean }

/** Parses a program. Without `branches` only the data-hazard subset is accepted (no labels, no branches).
 *  With `branches`: labels ("loop:"), a byte address in front of a line ("40: beq $1, $3, 7", as on
 *  slide 78), and beq/bne whose target is a label or a word offset from PC + 4. */
export function parseProgram(code: string, opts: ParseOptions = {}): Instr[] {
  const out: Draft[] = []
  const pendingLabels: string[] = []
  const labelAddr = new Map<string, number>()
  const branchArgs: { draft: Draft; target: string }[] = []
  let base = 0
  const nextAddr = () => base + out.length * 4
  code.split('\n').forEach((raw, index) => {
    let text = raw.replace(/#.*/, '').trim()
    if (!text) return
    try {
      if (!opts.branches && /^\w+:/.test(text)) throw new Error('Labels are only needed for branches, which come in the next lesson.')
      // Leading "40:" (an address) and "loop:" (a label), in any number.
      for (let m = text.match(/^(\w+)\s*:\s*/); m; m = text.match(/^(\w+)\s*:\s*/)) {
        const name = m[1]
        if (/^\d+$/.test(name)) {
          const a = Number(name)
          if (a % 4) throw new Error(`Address ${a} is not a multiple of 4.`)
          if (!out.length && !pendingLabels.length) base = a
          else if (a < nextAddr()) throw new Error(`Address ${a} is behind the previous instruction (next free address is ${nextAddr()}).`)
          else {
            // A gap ("..." on slide 78) holds zero words, and the zero word is nop.
            while (nextAddr() < a) {
              if (out.length >= MAX_INSTRUCTIONS) throw new Error(`The gap up to address ${a} is too long.`)
              out.push({ id: out.length, line: index + 1, text: 'nop', op: 'nop', rs: 0, rt: 0, rd: 0, imm: 0, addr: nextAddr(), filler: true })
            }
          }
        } else {
          if (/^\d/.test(name)) throw new Error(`"${name}" cannot be a label (it starts with a digit).`)
          if (labelAddr.has(name)) throw new Error(`Label "${name}" is defined twice.`)
          labelAddr.set(name, -1)
          pendingLabels.push(name)
        }
        text = text.slice(m[0].length)
      }
      if (!text) return
      const m = text.match(/^(\w+)\s*(.*)$/)
      if (!m) throw new Error(`"${text}" is not an instruction.`)
      const op = m[1].toLowerCase()
      const args = m[2] ? m[2].split(',').map((a) => a.trim()) : []
      const need = (n: number, form: string) => {
        if (args.length !== n || args.some((a) => !a)) throw new Error(`Write it as: ${op} ${form}`)
      }
      const common = { id: out.length, line: index + 1, text, addr: nextAddr() }
      let ins: Draft
      if ((R_OPS as string[]).includes(op)) {
        need(3, '$rd, $rs, $rt')
        ins = { ...common, op: op as Op, rd: register(args[0]), rs: register(args[1]), rt: register(args[2]), imm: 0 }
        ins.imm = (ins.rd! << 11) | FUNCT[op as Op]!
      } else if (op === 'addi') {
        need(3, '$rt, $rs, immediate')
        ins = { ...common, op, rt: register(args[0]), rs: register(args[1]), imm: integer(args[2], -32768, 32767) }
      } else if (op === 'lw' || op === 'sw') {
        need(2, '$rt, offset($rs)')
        const mm = args[1].match(/^(-?(?:0x[\da-f]+|\d+))?\s*\((\$\w+)\)$/i)
        if (!mm) throw new Error(`Write the address as offset($register), e.g. ${op} $t0, 8($s1)`)
        ins = { ...common, op, rt: register(args[0]), rs: register(mm[2]), imm: integer(mm[1] ?? '0', -32768, 32767) }
      } else if (op === 'nop') {
        if (args.length) throw new Error('nop takes no operands.')
        ins = { ...common, text: 'nop', op, rs: 0, rt: 0, rd: 0, imm: 0 }
      } else if (opts.branches && (op === 'beq' || op === 'bne')) {
        need(3, '$rs, $rt, label (or a word offset)')
        ins = { ...common, op, rs: register(args[0]), rt: register(args[1]), imm: 0 }
        branchArgs.push({ draft: ins, target: args[2] })
      } else if (opts.branches && NOT_IN_BRANCH_LAB[op]) {
        throw new Error(NOT_IN_BRANCH_LAB[op])
      } else if (!opts.branches && UNSUPPORTED[op]) {
        throw new Error(UNSUPPORTED[op])
      } else {
        throw new Error(`"${op}" is not in the slide datapath. Use add, sub, and, or, slt, nor, addi, lw, sw${opts.branches ? ', beq, bne' : ''} or nop.`)
      }
      for (const l of pendingLabels.splice(0)) labelAddr.set(l, ins.addr)
      if (labelAddr.size) ins.labels = [...labelAddr].filter(([, a]) => a === ins.addr).map(([l]) => l)
      if (!ins.labels?.length) delete ins.labels
      out.push(ins)
    } catch (e) {
      throw new Error(`Line ${index + 1}: ${(e as Error).message}`)
    }
  })
  if (!out.some((i) => !i.filler)) throw new Error('Type at least one instruction.')
  if (out.length > MAX_INSTRUCTIONS) throw new Error(`Use at most ${MAX_INSTRUCTIONS} instructions so the trace stays readable.`)
  const end = nextAddr()
  for (const l of pendingLabels) labelAddr.set(l, end) // a label after the last instruction marks the exit
  for (const { draft, target } of branchArgs) {
    try {
      let offset: number
      if (labelAddr.has(target)) offset = (labelAddr.get(target)! - (draft.addr + 4)) / 4
      else if (/^-?(?:0x[\da-f]+|\d+)$/i.test(target)) offset = integer(target, -32768, 32767)
      else throw new Error(`Label "${target}" is not defined.`)
      const t = draft.addr + 4 + offset * 4
      if (t < base || t > end) throw new Error(`The target address ${t} is outside the program (${base}–${end}).`)
      draft.imm = offset
      draft.target = t
    } catch (e) {
      throw new Error(`Line ${draft.line}: ${(e as Error).message}`)
    }
  }
  return out.map((ins) => {
    const word = encode(ins)
    // The immediate field holds rd and funct for R-format; the ID stage sign-extends it like any other.
    const imm16 = word & 0xffff
    return { ...ins, rd: (word >>> 11) & 31, imm: (imm16 << 16) >> 16, word }
  })
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

/** Control bits grouped as they sit in the pipeline registers: EX, M, WB. Branch is used only with branch hardware. */
export type Controls = { RegDst: number; ALUOp: number; ALUSrc: number; Branch: number; MemRead: number; MemWrite: number; RegWrite: number; MemtoReg: number }
export const ZERO_CONTROLS: Controls = { RegDst: 0, ALUOp: 0, ALUSrc: 0, Branch: 0, MemRead: 0, MemWrite: 0, RegWrite: 0, MemtoReg: 0 }

export function control(op: Op): Controls {
  if (op === 'lw') return { RegDst: 0, ALUOp: 0b00, ALUSrc: 1, Branch: 0, MemRead: 1, MemWrite: 0, RegWrite: 1, MemtoReg: 1 }
  if (op === 'sw') return { RegDst: 0, ALUOp: 0b00, ALUSrc: 1, Branch: 0, MemRead: 0, MemWrite: 1, RegWrite: 0, MemtoReg: 0 }
  if (op === 'addi') return { RegDst: 0, ALUOp: 0b00, ALUSrc: 1, Branch: 0, MemRead: 0, MemWrite: 0, RegWrite: 1, MemtoReg: 0 }
  if (isBranch(op)) return { RegDst: 0, ALUOp: 0b01, ALUSrc: 0, Branch: 1, MemRead: 0, MemWrite: 0, RegWrite: 0, MemtoReg: 0 }
  // R-format, including nop = sll $0,$0,0 (it writes $zero, which the register file ignores)
  return { RegDst: 1, ALUOp: 0b10, ALUSrc: 0, Branch: 0, MemRead: 0, MemWrite: 0, RegWrite: 1, MemtoReg: 0 }
}
/** Signals that are X (don't care) for an op; drawn as X but stored as 0. */
export const dontCare = (op: Op | undefined): (keyof Controls)[] => (op === 'sw' || isBranch(op) ? ['RegDst', 'MemtoReg'] : [])

/** ALU control (slide 4.13 table): ALUOp 00 → add, 01 → subtract (beq), 10 → from funct[3:0]. */
export function aluControl(aluOp: number, funct: number): { code: number; name: string } {
  if (aluOp === 0b01) return { code: 0b0110, name: 'sub' }
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

// ---------- hardware variants ----------

export type BranchAt = 'mem' | 'id'
export type Policy = 'predict' | 'stall' | 'delayed'
export type Hardware = { branch?: BranchAt; policy?: Policy }

// ---------- pipeline registers ----------

/** Why an instruction was thrown away: a taken branch flushed it, or it was fetched while
 *  the pipeline waited for a branch (stall-on-branch policy). */
export type Squash = { instr: Instr; why: 'flush' | 'wait' }

/** Every packet carries `seq`, one number per dynamic instance (a loop body fetched twice gets two). */
/** IF/ID: the fetched instruction word and PC + 4. IF.Flush turns the word into 0 = nop (`squashed` keeps what it was). */
export type IFID = { instr: Instr; pc4: number; seq: number; squashed?: Squash }
/** ID/EX. A bubble keeps the data fields of the stalled instruction but all its controls are 0 (slide 71). */
export type IDEX = { instr: Instr; seq: number; bubble: boolean; squashed?: Squash; ctrl: Controls; pc4: number; data1: number; data2: number; imm: number; rs: number; rt: number; rd: number }
/** EX/MEM. With the branch decided in MEM it also holds the branch target and Zero (Fig. 4.51). */
export type EXMEM = { instr: Instr; seq: number; bubble: boolean; squashed?: Squash; ctrl: Controls; aluResult: number; writeData: number; regRd: number; zero: number; target: number }
export type MEMWB = { instr: Instr; seq: number; bubble: boolean; squashed?: Squash; ctrl: Controls; readData: number; aluResult: number; regRd: number }
export type Latches = { pc: number; ifid: IFID | null; idex: IDEX | null; exmem: EXMEM | null; memwb: MEMWB | null }

/** Packet that really is the instruction (not a stall bubble, not a flushed slot). */
export const real = <T extends { bubble?: boolean; squashed?: Squash }>(p: T | null | undefined): T | null => (p && !p.bubble && !p.squashed ? p : null)

// ---------- what each stage does in a cycle ----------

/** One term of a forwarding condition, as written on slides 61/64. */
export type FwdCheck = { from: 'EX/MEM' | 'MEM/WB'; present: boolean; regWrite: number; rd: number; nonZero: boolean; match: boolean; holds: boolean }
export type Fwd = { sel: '00' | '10' | '01'; reg: number; field: 'Rs' | 'Rt'; value: number; ex: FwdCheck; mem: FwdCheck; double: boolean; unused: boolean }

/** Extra checks of the hazard detection unit when the branch is decided in ID (slides 80–81). */
export type BranchHazard = {
  /** The instruction in EX writes a register the branch compares: its value is ready only at the end of EX (ALU) or MEM (lw). */
  idexRegWrite: number; idexDest: number; idexLoad: boolean; aluRs: boolean; aluRt: boolean
  /** A load in MEM writes a register the branch compares: the data comes out of memory only at the end of MEM. */
  exmemMemRead: number; exmemRd: number; loadRs: boolean; loadRt: boolean
  stall: boolean
}
export type Hazard = { checked: boolean; memRead: number; idexRt: number; ifidRs: number; ifidRt: number; matchRs: boolean; matchRt: boolean; loadUse: boolean; stall: boolean; conservative: boolean; branch: BranchHazard | null
  /** The unit asked for a stall, but a taken branch in MEM flushed those instructions instead. */
  overridden?: boolean }

/** Branch comparator input with its EX/MEM forwarding check (slide 79). */
export type CmpFwd = { reg: number; field: 'Rs' | 'Rt'; sel: 0 | 1; original: number; value: number; check: FwdCheck }

/** A branch decided in this cycle: in ID (comparator) or in MEM (Branch AND Zero). */
export type BranchEval = {
  at: BranchAt
  instr: Instr
  seq: number
  pc4: number
  target: number
  a: number
  b: number
  equal: boolean
  taken: boolean
  fa: CmpFwd | null // ID only
  fb: CmpFwd | null
}

export type Cycle = {
  n: number
  /** Pipeline state latched at the rising edge that starts this cycle. */
  at: Latches
  regs: number[] // register file at the start of the cycle
  regsMid: number[] // after the first-half write
  memory: Record<number, number> // data memory during the cycle (stores land at the next edge)
  fetch: { instr: Instr | null; pc: number; pc4: number; seq: number; repeat: boolean }
  wb: { value: number; regWrite: number; memtoReg: number; rd: number; writes: boolean; old: number } | null
  id: { instr: Instr; data1: number; data2: number; ctrl: Controls; ctrlOut: Controls; sameCycleRs: boolean; sameCycleRt: boolean } | null
  hazard: Hazard
  ex: { fa: Fwd; fb: Fwd; aluA: number; aluB: number; aluCtl: { code: number; name: string }; result: number; regDst: number; writeData: number; zero: number; target: number } | null
  mem: { address: number; read: boolean; write: boolean; readData: number; old: number } | null
  /** The branch decided this cycle, if any. */
  branch: BranchEval | null
  /** Whether the pipeline is waiting for an undecided branch (stall-on-branch policy). */
  waiting: boolean
  /** What the next edge throws away: IF.Flush / ID.Flush / EX.Flush, or fetches discarded while waiting. */
  squash: { ifid: boolean; idex: boolean; exmem: boolean; why: 'flush' | 'wait' } | null
  pcSrc: number
  pcWrite: number
  ifidWrite: number
  next: Latches
}

export type Simulation = {
  program: Instr[]
  hw: Hardware
  base: number
  cycles: Cycle[]
  final: { regs: number[]; memory: Record<number, number> }
  stalls: number
  /** Slots thrown away because of branches (flushed or discarded fetches). */
  flushes: number
  /** Instructions that really completed (stall bubbles and flushed slots excluded). */
  completed: number
  /** Cycles where IF had nothing to fetch (past the end of the program) but the program went on. */
  idle: number
}

function fwdCheck(from: FwdCheck['from'], p: { ctrl: Controls; regRd: number } | null, reg: number): FwdCheck {
  if (!p) return { from, present: false, regWrite: 0, rd: 0, nonZero: false, match: false, holds: false }
  const regWrite = p.ctrl.RegWrite, rd = p.regRd
  const nonZero = rd !== 0, match = rd === reg
  return { from, present: true, regWrite, rd, nonZero, match, holds: !!regWrite && nonZero && match }
}

const usesRt = (op: Op) => (R_OPS as string[]).includes(op) || op === 'sw' || isBranch(op)

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

/** The word IF.Flush leaves in IF/ID: all zeros, which decodes as nop (sll $0, $0, 0). */
const nopOf = (i: Instr): Instr => ({ ...i, op: 'nop', text: 'nop', rs: 0, rt: 0, rd: 0, imm: 0, word: 0, target: undefined, labels: undefined })

export function simulate(program: Instr[], regs0: number[], memory0: Record<number, number>, hw: Hardware = {}): Simulation {
  const base = program[0]?.addr ?? 0
  const policy: Policy = hw.policy ?? 'predict'
  if (policy === 'delayed' && hw.branch !== 'id') throw new Error('A delayed branch needs the branch decided in ID (one delay slot).')
  const at0: Latches = { pc: base, ifid: null, idex: null, exmem: null, memwb: null }
  let at = at0
  let regs = [...regs0]
  regs[0] = 0
  let memory = { ...memory0 }
  const cycles: Cycle[] = []
  let stalls = 0, flushes = 0, completed = 0
  let seqCounter = 0
  let heldSeq = -1 // the fetch of the previous cycle was held by a stall, so this fetch is the same instance
  const fetchAt = (pc: number) => {
    const k = (pc - base) / 4
    return k >= 0 && k < program.length ? program[k] : null
  }
  const limit = hw.branch ? MAX_CYCLES : program.length * 3 + 10
  for (let n = 1; fetchAt(at.pc) || at.ifid || at.idex || at.exmem || at.memwb; n++) {
    if (n > limit) throw new Error(hw.branch ? `The program is still running after ${MAX_CYCLES} cycles. Is there an endless loop?` : 'The simulation did not finish.')
    const { ifid, idex, exmem, memwb } = at

    // WB, first half: the register file is written.
    const regsMid = [...regs]
    let wb: Cycle['wb'] = null
    if (memwb) {
      const value = memwb.ctrl.MemtoReg ? memwb.readData : memwb.aluResult
      const writes = !!memwb.ctrl.RegWrite && memwb.regRd !== 0
      if (writes) regsMid[memwb.regRd] = value
      wb = { value, regWrite: memwb.ctrl.RegWrite, memtoReg: memwb.ctrl.MemtoReg, rd: memwb.regRd, writes, old: regs[memwb.regRd] }
      if (real(memwb)) completed++
    }
    const wbValue = wb?.value ?? 0

    // ID, second half: read the register file; the hazard detection unit compares register numbers.
    let id: Cycle['id'] = null
    const hazard: Hazard = { checked: false, memRead: 0, idexRt: 0, ifidRs: 0, ifidRt: 0, matchRs: false, matchRt: false, loadUse: false, stall: false, conservative: false, branch: null }
    let branch: BranchEval | null = null
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
        hazard.loadUse = !!idex.ctrl.MemRead && (hazard.matchRs || hazard.matchRt)
        // The slide-69 unit compares numbers only: it also stalls when rt is merely addi's or lw's destination.
        hazard.conservative = hazard.loadUse && !hazard.matchRs && !usesRt(i.op)
      }
      if (hw.branch === 'id' && isBranch(i.op)) {
        // Slides 80–81: the comparator needs both registers at the start of ID.
        const idexDest = idex && idex.ctrl.RegWrite ? (idex.ctrl.RegDst ? idex.rd : idex.rt) : 0
        const exmemRd = exmem && exmem.ctrl.MemRead ? exmem.regRd : 0
        const b: BranchHazard = {
          idexRegWrite: idex?.ctrl.RegWrite ?? 0, idexDest, idexLoad: !!idex?.ctrl.MemRead,
          aluRs: idexDest !== 0 && idexDest === i.rs, aluRt: idexDest !== 0 && idexDest === i.rt,
          exmemMemRead: exmem?.ctrl.MemRead ?? 0, exmemRd,
          loadRs: exmemRd !== 0 && exmemRd === i.rs, loadRt: exmemRd !== 0 && exmemRd === i.rt,
          stall: false,
        }
        b.stall = b.aluRs || b.aluRt || b.loadRs || b.loadRt
        hazard.branch = b
        hazard.checked = true
      }
      hazard.stall = hazard.loadUse || !!hazard.branch?.stall
      const ctrl = control(i.op)
      const sameCycle = (r: number) => !!wb?.writes && wb.rd === r
      id = { instr: i, data1: regsMid[i.rs], data2: regsMid[i.rt], ctrl, ctrlOut: hazard.stall ? ZERO_CONTROLS : ctrl, sameCycleRs: sameCycle(i.rs), sameCycleRt: sameCycle(i.rt) }

      // Branch decided in ID: comparator with EX/MEM forwarding (slide 79) and the target adder.
      if (hw.branch === 'id' && isBranch(i.op) && !hazard.stall) {
        const cmp = (field: 'Rs' | 'Rt'): CmpFwd => {
          const reg = field === 'Rs' ? i.rs : i.rt
          const original = field === 'Rs' ? id!.data1 : id!.data2
          const check = fwdCheck('EX/MEM', exmem, reg)
          return { reg, field, sel: check.holds ? 1 : 0, original, value: check.holds ? exmem!.aluResult : original, check }
        }
        const fa = cmp('Rs'), fb = cmp('Rt')
        const equal = fa.value === fb.value
        branch = { at: 'id', instr: i, seq: ifid.seq, pc4: ifid.pc4, target: (ifid.pc4 + (i.imm << 2)) | 0, a: fa.value, b: fb.value, equal, taken: i.op === 'beq' ? equal : !equal, fa, fb }
      }
    }

    // EX: forwarding unit, ALU (and with the branch decided in MEM: target adder and Zero).
    let ex: Cycle['ex'] = null
    if (idex) {
      const fa = forward('Rs', idex, exmem, memwb, wbValue)
      const fb = forward('Rt', idex, exmem, memwb, wbValue)
      const aluB = idex.ctrl.ALUSrc ? idex.imm : fb.value
      const aluCtl = aluControl(idex.ctrl.ALUOp, idex.imm & 0x3f)
      const result = alu(aluCtl.code, fa.value, aluB)
      ex = { fa, fb, aluA: fa.value, aluB, aluCtl, result, regDst: idex.ctrl.RegDst ? idex.rd : idex.rt, writeData: fb.value, zero: result === 0 ? 1 : 0, target: (idex.pc4 + (idex.imm << 2)) | 0 }
    }

    // MEM: data memory. A store is written at the end of the cycle.
    let mem: Cycle['mem'] = null
    if (exmem && (exmem.ctrl.MemRead || exmem.ctrl.MemWrite)) {
      const address = exmem.aluResult >>> 0
      if (address % 4) throw new Error(`Cycle ${n}: ${exmem.instr.text} uses address ${address}, which is not a multiple of 4.`)
      mem = { address, read: !!exmem.ctrl.MemRead, write: !!exmem.ctrl.MemWrite, readData: memory[address] ?? 0, old: memory[address] ?? 0 }
    }
    // Branch decided in MEM: PCSrc = Branch AND Zero (bne: Branch AND NOT Zero).
    if (hw.branch === 'mem' && exmem && exmem.ctrl.Branch) {
      const equal = !!exmem.zero
      branch = { at: 'mem', instr: exmem.instr, seq: exmem.seq, pc4: exmem.instr.addr + 4, target: exmem.target, a: 0, b: 0, equal, taken: exmem.instr.op === 'beq' ? equal : !equal, fa: null, fb: null }
    }

    // IF
    const fetched = fetchAt(at.pc)
    const repeat = heldSeq >= 0 && !!fetched
    const fetchSeq = fetched ? (repeat ? heldSeq : seqCounter++) : -1
    const fetch = { instr: fetched, pc: at.pc, pc4: at.pc + 4, seq: fetchSeq, repeat }

    // Next rising edge. A taken branch that was predicted not taken flushes the younger instructions;
    // with the branch in MEM that wins over a load-use stall (the stalled instructions are on the wrong path).
    const undecided = (p: { instr: Instr; bubble?: boolean; squashed?: Squash } | null) => !!real(p) && isBranch(p!.instr.op)
    const flush = policy === 'predict' && !!branch?.taken
    const stall = hazard.stall && !(flush && hw.branch === 'mem')
    // Stall-on-branch policy: while a branch is undecided, whatever IF fetches is thrown away.
    const waiting = policy === 'stall' && !!hw.branch && !stall && (undecided(ifid) || (hw.branch === 'mem' && (undecided(idex) || undecided(exmem))))
    if (stall) stalls++
    const squashIF = (why: Squash['why']): IFID | null => (fetched ? { instr: nopOf(fetched), pc4: at.pc + 4, seq: fetchSeq, squashed: { instr: fetched, why } } : null)
    // ID.Flush / EX.Flush: the controls become 0, like a stall bubble (slide 77: "set control values to 0").
    const flushed = <T extends { instr: Instr; ctrl: Controls; bubble: boolean; squashed?: Squash }>(p: T): T =>
      ({ ...p, bubble: true, ctrl: ZERO_CONTROLS, squashed: p.squashed ?? (p.bubble ? undefined : { instr: p.instr, why: 'flush' }) })

    let nextIdex: IDEX | null = ifid && id
      ? { instr: ifid.instr, seq: stall ? seqCounter++ : ifid.seq, bubble: stall, squashed: stall ? undefined : ifid.squashed, ctrl: id.ctrlOut, pc4: ifid.pc4, data1: id.data1, data2: id.data2, imm: ifid.instr.imm, rs: ifid.instr.rs, rt: ifid.instr.rt, rd: ifid.instr.rd }
      : null
    let nextExmem: EXMEM | null = idex && ex ? { instr: idex.instr, seq: idex.seq, bubble: idex.bubble, squashed: idex.squashed, ctrl: idex.ctrl, aluResult: ex.result, writeData: ex.writeData, regRd: ex.regDst, zero: ex.zero, target: ex.target } : null
    let nextIfid: IFID | null = stall ? ifid : fetched ? { instr: fetched, pc4: at.pc + 4, seq: fetchSeq } : null
    let nextPc = stall || !fetched ? at.pc : at.pc + 4
    let squash: Cycle['squash'] = null
    if (waiting) {
      nextIfid = squashIF('wait')
      nextPc = branch ? (branch.taken ? branch.target : branch.pc4) : at.pc
      squash = { ifid: !!fetched, idex: false, exmem: false, why: 'wait' }
    } else if (branch?.taken) {
      nextPc = branch.target
      if (flush) {
        nextIfid = squashIF('flush')
        const idFlush = hw.branch === 'mem' && !!nextIdex, exFlush = hw.branch === 'mem' && !!nextExmem
        if (idFlush) nextIdex = flushed(nextIdex!)
        if (exFlush) nextExmem = flushed(nextExmem!)
        // Count only slots that were real instructions (a bubble flushed again was already counted).
        squash = { ifid: !!fetched, idex: idFlush && !ifid!.squashed, exmem: exFlush && !idex!.bubble && !idex!.squashed, why: 'flush' }
      }
    }
    if (squash) flushes += +squash.ifid + +squash.idex + +squash.exmem
    const pcSrc = branch?.taken ? 1 : 0
    heldSeq = stall && fetched ? fetchSeq : -1
    const next: Latches = {
      pc: nextPc,
      ifid: nextIfid,
      idex: nextIdex,
      exmem: nextExmem,
      memwb: exmem ? { instr: exmem.instr, seq: exmem.seq, bubble: exmem.bubble, squashed: exmem.squashed, ctrl: exmem.ctrl, readData: mem?.read ? mem.readData : 0, aluResult: exmem.aluResult, regRd: exmem.regRd } : null,
    }

    // Flush wins over a stall (MEM decision): report the stall the unit asked for as overridden.
    if (hazard.stall && !stall) hazard.overridden = true
    cycles.push({ n, at, regs, regsMid, memory, fetch, wb, id, hazard, ex, mem, branch, waiting, squash, pcSrc, pcWrite: hazard.stall ? 0 : 1, ifidWrite: hazard.stall ? 0 : 1, next })

    const nextMemory = { ...memory }
    if (mem?.write) nextMemory[mem.address] = exmem!.writeData
    memory = nextMemory
    regs = regsMid
    at = next
  }
  numericNames = program.some((i) => /\$\d/.test(i.text))
  // Every slot that reaches WB is an instruction, a stall bubble, a flushed slot or an empty fetch.
  const idle = cycles.length - 4 - completed - stalls - flushes
  return { program, hw, base, cycles, final: { regs, memory }, stalls, flushes, completed, idle }
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
  if (isBranch(i.op)) return [{ field: 'Rs', reg: i.rs, role: 'compared' }, { field: 'Rt', reg: i.rt, role: 'compared' }]
  return [{ field: 'Rs', reg: i.rs, role: 'rs' }, { field: 'Rt', reg: i.rt, role: 'rt' }]
}
export const destination = (i: Instr) => (control(i.op).RegWrite ? (control(i.op).RegDst ? i.rd : i.rt) : 0)

/** Data dependences of a straight-line program (the data-hazard lab). */
export function dependences(sim: Simulation): Dependence[] {
  const out: Dependence[] = []
  const exCycle = (id: number) => sim.cycles.find((c) => real(c.at.idex)?.instr.id === id)
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

// ---------- branches (for the control-hazard overview) ----------

export type BranchRun = {
  seq: number
  instr: Instr
  /** How many times this static branch had run before (0 = first time). */
  nth: number
  cycle: number // when it was decided
  taken: boolean
  target: number
  a: number
  b: number
  /** Slots lost behind the branch: flushed or discarded while waiting. */
  lost: number
  /** Stall cycles in ID before the comparator could run (branch in ID only). */
  dataStalls: number
  forwarded: ('Rs' | 'Rt')[]
}

export function branchRuns(sim: Simulation): BranchRun[] {
  const out: BranchRun[] = []
  const seen = new Map<number, number>()
  sim.cycles.forEach((c, k) => {
    const b = c.branch
    if (!b) return
    const nth = seen.get(b.instr.id) ?? 0
    seen.set(b.instr.id, nth + 1)
    // Lost slots: everything thrown away from the cycle the branch entered ID until it was decided.
    let first = k
    while (first > 0 && sim.cycles[first - 1].at.ifid?.seq !== b.seq && [sim.cycles[first - 1].at.idex, sim.cycles[first - 1].at.exmem].some((p) => p?.seq === b.seq)) first--
    while (first > 0 && sim.cycles[first - 1].at.ifid?.seq === b.seq) first--
    let lost = 0
    for (let j = first; j <= k; j++) {
      const s = sim.cycles[j].squash
      if (s) lost += +s.ifid + +s.idex + +s.exmem
    }
    const dataStalls = sim.cycles.filter((x) => x.at.ifid?.seq === b.seq && x.hazard.stall).length
    const forwarded = [b.fa, b.fb].filter((f): f is CmpFwd => !!f && f.sel === 1).map((f) => f.field)
    out.push({ seq: b.seq, instr: b.instr, nth, cycle: c.n, taken: b.taken, target: b.target, a: b.a, b: b.b, lost, dataStalls, forwarded })
  })
  return out
}
