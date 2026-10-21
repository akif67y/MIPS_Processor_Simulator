// Pure, deterministic five-stage data-hazard model. The UI and timing chart use
// these same snapshots; no separate scheduling approximation is involved.
export const NAMES = ['zero', 'at', 'v0', 'v1', 'a0', 'a1', 'a2', 'a3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 't8', 't9', 'k0', 'k1', 'gp', 'sp', 'fp', 'ra']
export const regName = (n: number) => `$${NAMES[n]}`
export const hex = (n: number) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`
export type Instruction = { id: number; text: string; op: string; rs: number; rt: number; dest: number; imm: number; usesA: boolean; usesB: boolean }
export type Controls = { RegWrite: number; MemRead: number; MemWrite: number; MemtoReg: number; ALUSrc: number; RegDst: number; ALUOp: string; ALUControl: string }
export type Packet = { ins: Instruction | null; bubble: number | null; pc4: number; a: number; b: number; result: number; store: number; loaded: number; control: Controls }
export type State = { cycle: number; half: 0 | 1; pc: number; regs: number[]; memory: Record<number, number>; ifid: Packet | null; idex: Packet | null; exmem: Packet | null; memwb: Packet | null }
export type Selection = { select: '00' | '10' | '01'; value: number; source: string; priority: boolean; pending: boolean }
export type Signals = { stall: boolean; matchA: boolean; matchB: boolean; a: Selection; b: Selection; aluB: number; result: number; store: number; storeForward: boolean; memoryRead: number | null; wb: { dest: number; value: number } | null; decodeA: number; decodeB: number }
export type Frame = { state: State; signals: Signals }
export type Simulation = { program: Instruction[]; frames: Frame[]; final: State; stalls: number }
const R = ['add', 'addu', 'sub', 'subu', 'and', 'or', 'xor', 'nor', 'slt', 'sltu']
const I = ['addi', 'addiu', 'andi', 'ori', 'xori', 'slti', 'sltiu']

export function register(s: string): number {
  const name = s.trim().toLowerCase().replace(/^\$/, '')
  const n = /^\d+$/.test(name) ? Number(name) : name === 's8' ? 30 : NAMES.indexOf(name)
  if (!s.trim().startsWith('$') || n < 0 || n > 31) throw new Error(`Invalid register “${s}”. Use $0–$31 or a MIPS register name.`)
  return n
}
function integer(s: string, min: number, max: number) {
  if (!/^-?(?:0x[\da-f]+|\d+)$/i.test(s)) throw new Error(`Invalid integer “${s}”.`)
  const n = s.startsWith('-') ? -Number(s.slice(1)) : Number(s)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`“${s}” must be between ${min} and ${max}.`)
  return n
}
export function parseProgram(code: string): Instruction[] {
  const result: Instruction[] = []
  code.split('\n').forEach((line, index) => {
    const text = line.replace(/#.*/, '').trim()
    if (!text) return
    try {
      const [op, ...tail] = text.toLowerCase().split(/\s+/)
      const args = tail.join('').split(',')
      const ins: Instruction = { id: result.length, text, op, rs: 0, rt: 0, dest: 0, imm: 0, usesA: false, usesB: false }
      const arity = (n: number) => { if (args.length !== n || args.some(x => !x)) throw new Error(`${op} requires ${n} operands.`) }
      if (R.includes(op)) {
        arity(3); ins.dest = register(args[0]); ins.rs = register(args[1]); ins.rt = register(args[2]); ins.usesA = ins.usesB = true
      } else if (I.includes(op)) {
        arity(3); ins.dest = ins.rt = register(args[0]); ins.rs = register(args[1]); ins.usesA = true
        ins.imm = integer(args[2], ['andi', 'ori', 'xori'].includes(op) ? 0 : -32768, ['andi', 'ori', 'xori'].includes(op) ? 65535 : 32767)
      } else if (op === 'lw' || op === 'sw') {
        arity(2)
        const m = args[1].match(/^(-?(?:0x[\da-f]+|\d+))\((\$\w+)\)$/i)
        if (!m) throw new Error('Use offset($register) for memory operands.')
        ins.rt = register(args[0]); ins.rs = register(m[2]); ins.imm = integer(m[1], -32768, 32767); ins.usesA = true
        ins.usesB = op === 'sw'; ins.dest = op === 'lw' ? ins.rt : 0
      } else if (op === 'nop') {
        if (tail.length) throw new Error('nop takes no operands.')
      } else throw new Error(`“${op}” is outside Task 1. Use ALU instructions, immediates, lw, sw or nop; branches and jumps come later.`)
      result.push(ins)
    } catch (error) { throw new Error(`Line ${index + 1}: ${(error as Error).message}`) }
  })
  if (!result.length) throw new Error('Enter at least one instruction.')
  if (result.length > 64) throw new Error('Use at most 64 instructions for a readable trace.')
  return result
}
export function parseInitial(registerText: string, memoryText: string) {
  const regs = Array<number>(32).fill(0), memory: Record<number, number> = {}
  const assignments = (text: string, fn: (key: string, value: number) => void) => text.split(/[\n,]/).forEach(line => {
    const clean = line.replace(/#.*/, '').trim()
    if (!clean) return
    const parts = clean.split('=').map(s => s.trim())
    if (parts.length !== 2) throw new Error(`Expected name=value, got “${clean}”.`)
    fn(parts[0], integer(parts[1], -2147483648, 4294967295) | 0)
  })
  assignments(registerText, (key, value) => {
    const r = register(key)
    if (r === 0 && value !== 0) throw new Error('$zero must be 0.')
    regs[r] = value
  })
  assignments(memoryText, (key, value) => {
    const address = integer(key, 0, 4294967295)
    if (address % 4) throw new Error(`Memory address ${key} must be word-aligned (multiple of 4).`)
    memory[address] = value
  })
  return { regs, memory }
}
export function controls(ins: Instruction | null): Controls {
  const op = ins?.op ?? 'nop'
  return { RegWrite: +(op !== 'sw' && op !== 'nop'), MemRead: +(op === 'lw'), MemWrite: +(op === 'sw'), MemtoReg: +(op === 'lw'), ALUSrc: +(I.includes(op) || op === 'lw' || op === 'sw'), RegDst: +R.includes(op),
    ALUOp: R.includes(op) ? '10' : ['andi', 'ori', 'xori', 'slti', 'sltiu'].includes(op) ? '11' : '00',
    ALUControl: op === 'nop' ? '0' : op === 'lw' || op === 'sw' ? 'add' : op }
}
function packet(ins: Instruction | null, bubble: number | null = null): Packet {
  return { ins, bubble, pc4: ins ? ins.id * 4 + 4 : 0, a: 0, b: 0, result: 0, store: 0, loaded: 0, control: controls(ins) }
}
const writes = (p: Packet | null) => !!p?.control.RegWrite && !!p.ins?.dest
export const wbValue = (p: Packet) => p.control.MemtoReg ? p.loaded : p.result
function select(s: State, reg: number, original: number, used: boolean): Selection {
  const ex = used && reg !== 0 && writes(s.exmem) && s.exmem!.ins!.dest === reg
  const mem = used && reg !== 0 && writes(s.memwb) && s.memwb!.ins!.dest === reg
  // A newer load blocks an older matching writer, even though its result is not
  // yet available. This only occurs for store data, repaired by the MEM bypass.
  if (ex && s.exmem!.control.MemRead) return { select: '00', value: original, source: 'Pending load → store in MEM', priority: false, pending: true }
  if (ex) return { select: '10', value: s.exmem!.result, source: 'EX/MEM', priority: !!mem, pending: false }
  if (mem) return { select: '01', value: wbValue(s.memwb!), source: 'MEM/WB', priority: false, pending: false }
  return { select: '00', value: original, source: 'ID/EX', priority: false, pending: false }
}
function alu(op: string, a: number, b: number) {
  switch (op) {
    case 'sub': case 'subu': return (a - b) | 0
    case 'and': case 'andi': return a & b
    case 'or': case 'ori': return a | b
    case 'xor': case 'xori': return a ^ b
    case 'nor': return ~(a | b)
    case 'slt': case 'slti': return +(a < b)
    case 'sltu': case 'sltiu': return +((a >>> 0) < (b >>> 0))
    case 'nop': return 0
    default: return (a + b) | 0
  }
}
export function signals(s: State): Signals {
  const d = s.ifid?.ins, e = s.idex?.ins, m = s.exmem?.ins
  const load = e?.op === 'lw' && e.dest !== 0
  const matchA = !!(load && d?.usesA && d.rs === e.dest)
  // Store rt is needed in MEM, not EX. An immediate's rt is a destination.
  const matchB = !!(load && d?.usesB && d.op !== 'sw' && d.rt === e.dest)
  const a = select(s, e?.rs ?? 0, s.idex?.a ?? 0, !!e?.usesA)
  const b = select(s, e?.rt ?? 0, s.idex?.b ?? 0, !!e?.usesB)
  const aluB = s.idex?.control.ALUSrc ? e!.imm : b.value
  const storeForward = !!(m?.op === 'sw' && m.rt !== 0 && writes(s.memwb) && s.memwb!.ins!.dest === m.rt)
  const store = storeForward ? wbValue(s.memwb!) : s.exmem?.store ?? 0
  if (m && (m.op === 'lw' || m.op === 'sw') && (s.exmem!.result >>> 0) % 4) {
    throw new Error(`Cycle ${s.cycle}, I${m.id + 1}: unaligned ${m.op} address ${hex(s.exmem!.result)}. Use a byte address divisible by 4.`)
  }
  return { stall: matchA || matchB, matchA, matchB, a, b, aluB, result: alu(e?.op ?? 'nop', a.value, aluB), store, storeForward,
    memoryRead: m?.op === 'lw' ? s.memory[s.exmem!.result >>> 0] ?? 0 : null,
    wb: writes(s.memwb) ? { dest: s.memwb!.ins!.dest, value: wbValue(s.memwb!) } : null,
    decodeA: s.regs[d?.rs ?? 0], decodeB: s.regs[d?.rt ?? 0] }
}
export function simulate(program: Instruction[], regs: number[], memory: Record<number, number>): Simulation {
  let s: State = { cycle: 1, half: 0, pc: 0, regs: [...regs], memory: { ...memory }, ifid: null, idex: null, exmem: null, memwb: null }
  s.regs[0] = 0
  const frames: Frame[] = []
  let stalls = 0
  while (s.pc / 4 < program.length || s.ifid || s.idex || s.exmem || s.memwb) {
    const first = signals(s)
    frames.push({ state: s, signals: first })
    const nextRegs = [...s.regs]
    if (first.wb) nextRegs[first.wb.dest] = first.wb.value
    s = { ...s, half: 1, regs: nextRegs }
    const sig = signals(s)
    frames.push({ state: s, signals: sig })
    const nextMemory = { ...s.memory }
    if (s.exmem?.control.MemWrite) nextMemory[s.exmem.result >>> 0] = sig.store
    const memwb = s.exmem ? { ...s.exmem, loaded: sig.memoryRead ?? 0 } : null
    const exmem = s.idex ? { ...s.idex, result: sig.result, store: sig.b.value } : null
    let idex: Packet | null, ifid = s.ifid, pc = s.pc
    if (sig.stall) { idex = packet(null, ++stalls) }
    else {
      idex = s.ifid ? { ...s.ifid, a: sig.decodeA, b: sig.decodeB } : null
      const fetched = program[s.pc / 4]
      ifid = fetched ? packet(fetched) : null
      if (fetched) pc += 4
    }
    s = { cycle: s.cycle + 1, half: 0, pc, regs: nextRegs, memory: nextMemory, ifid, idex, exmem, memwb }
  }
  return { program, frames, final: s, stalls }
}

export function dependencies(program: Instruction[]) {
  const last = new Map<number, Instruction>()
  const result: string[] = []
  for (const ins of program) {
    for (const [used, reg, name] of [[ins.usesA, ins.rs, 'rs'], [ins.usesB, ins.rt, ins.op === 'sw' ? 'store data' : 'rt']] as const) {
      const producer = used && reg !== 0 ? last.get(reg) : undefined
      if (producer) result.push(`I${producer.id + 1} → I${ins.id + 1}: ${regName(reg)} (${name}), needed in ${name === 'store data' ? 'MEM' : 'EX'}.`)
    }
    if (controls(ins).RegWrite && ins.dest) last.set(ins.dest, ins)
  }
  return result
}
