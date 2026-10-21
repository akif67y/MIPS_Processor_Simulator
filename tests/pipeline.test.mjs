import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProgram, parseInitial, simulate, dependences, ZERO_CONTROLS } from '../src/pipeline/engine.ts'
import { buildSteps, explain } from '../src/pipeline/explain.ts'
import { EXAMPLES } from '../src/pipeline/examples.ts'

const run = (code, registers = '$t0=256, $t1=7, $t2=3', memory = '256=9, 260=13') => {
  const init = parseInitial(registers, memory)
  return simulate(parseProgram(code), init.regs, init.memory)
}
const cyc = (sim, n) => sim.cycles[n - 1]
const example = (name) => {
  const e = EXAMPLES.find((x) => x.name === name)
  return run(e.code, e.registers, e.memory)
}

test('every example takes 5 + (n − 1) + stalls cycles', () => {
  for (const e of EXAMPLES) {
    const sim = run(e.code, e.registers, e.memory)
    assert.equal(sim.cycles.length, 5 + sim.program.length - 1 + sim.stalls, e.name)
    assert.equal(sim.final.regs[0], 0)
  }
})

test('machine code matches the MIPS encoding', () => {
  const p = parseProgram('lw $2, 20($1)\nand $4, $2, $5\nsw $15, 100($2)\naddi $2, $5, -1\nnop')
  assert.deepEqual(p.map((i) => i.word), [0x8c220014, 0x00452024, 0xac4f0064, 0x20a2ffff, 0])
  // rd is bits 15–11 for every format, as the hardware passes it to ID/EX
  assert.equal(p[0].rd, (20 >> 11) & 31)
  assert.equal(p[1].rd, 4)
})

test('slide 59: EX hazard sets ForwardA = 10', () => {
  const sim = example('EX hazard → ForwardA = 10')
  const c = cyc(sim, 4)
  assert.equal(c.ex.fa.sel, '10')
  assert.equal(c.ex.fa.value, -20)
  assert.equal(sim.final.regs[12], -20 & 15)
})

test('slide 60: MEM hazard sets ForwardB = 01', () => {
  const sim = example('MEM hazard → ForwardB = 01')
  assert.equal(cyc(sim, 5).ex.fb.sel, '01')
  assert.equal(sim.final.regs[13], 12 | -20)
})

test('slides 62–64: double data hazard, the newest value wins', () => {
  const sim = example('Double data hazard')
  const c = cyc(sim, 5)
  assert.equal(c.ex.fa.sel, '10')
  assert.equal(c.ex.fa.double, true)
  assert.equal(c.ex.fa.value, 60)
  assert.equal(c.wb.value, 40)
  assert.equal(sim.final.regs[1], 64)
})

test('slide 55: write in the first half, read in the second half', () => {
  const sim = example('Write first half, read second half')
  const c = cyc(sim, 5)
  assert.equal(c.regs[2], 0)
  assert.equal(c.regsMid[2], -20)
  assert.equal(c.id.data1, -20)
  assert.equal(c.id.sameCycleRs, true)
  assert.equal(cyc(sim, 6).ex.fa.sel, '00')
  assert.equal(sim.final.regs[14], -40)
})

test('slide 57: no forwarding without RegWrite or to $zero', () => {
  const sim = example('RegWrite and $zero checks')
  const sub = cyc(sim, 4).ex.fa // sub $4,$0,$1 behind add $0,...
  assert.equal(sub.ex.match, true)
  assert.equal(sub.ex.nonZero, false)
  assert.equal(sub.sel, '00')
  const add = cyc(sim, 6).ex.fa // add $6,$5,$5 behind sw $5,...
  assert.equal(add.ex.match, true)
  assert.equal(add.ex.regWrite, 0)
  assert.equal(add.sel, '00')
  assert.equal(sim.final.regs[0], 0)
})

test('slides 67–74: load-use stall holds PC and IF/ID and inserts a bubble', () => {
  const sim = example('Load-use hazard (slides 67–74)')
  assert.equal(sim.cycles.length, 10)
  assert.equal(sim.stalls, 1)
  const c3 = cyc(sim, 3), c4 = cyc(sim, 4), c5 = cyc(sim, 5)
  assert.equal(c3.hazard.stall, true)
  assert.equal(c3.hazard.matchRs, true)
  assert.equal(c3.pcWrite, 0)
  assert.equal(c3.ifidWrite, 0)
  assert.equal(c4.at.pc, c3.at.pc)
  assert.equal(c4.at.ifid, c3.at.ifid)
  // slide 71: only the control fields are zeroed; the data fields are still latched
  assert.equal(c4.at.idex.bubble, true)
  assert.deepEqual(c4.at.idex.ctrl, ZERO_CONTROLS)
  assert.equal(c4.at.idex.instr.text, 'and $4, $2, $5')
  assert.equal(c4.at.idex.rs, 2)
  assert.equal(c4.at.exmem.instr.op, 'lw')
  assert.equal(c5.ex.fa.sel, '01')
  assert.equal(c5.ex.fa.value, 42)
  assert.equal(cyc(sim, 6).at.memwb.bubble, true)
  assert.equal(sim.final.regs[4], 42 & 15)
  assert.equal(sim.final.regs[9], (42 & 15) + 42)
})

test('slide 69: lw followed by sw of the loaded register stalls (no MEM-to-MEM path)', () => {
  const sim = example('lw → sw (memory copy)')
  assert.equal(sim.stalls, 1)
  assert.equal(cyc(sim, 3).hazard.matchRt, true)
  assert.equal(cyc(sim, 5).ex.fb.sel, '01')
  assert.equal(sim.final.memory[128], 42)
})

test('slide 69 compares numbers only: addi writing the loaded register stalls too', () => {
  const sim = example('Stall without a real dependence')
  assert.equal(sim.stalls, 1)
  assert.equal(cyc(sim, 3).hazard.conservative, true)
  assert.equal(sim.final.regs[2], 22)
  assert.equal(sim.final.regs[3], 44)
})

test('slides 22–24: code scheduling removes both stalls', () => {
  assert.equal(example('Before scheduling').cycles.length, 13)
  assert.equal(example('After scheduling').cycles.length, 11)
  assert.deepEqual(example('Before scheduling').final.memory, example('After scheduling').final.memory)
})

test('ALU result forwarded as store data through ForwardB', () => {
  const sim = example('ALU → sw data')
  const c = cyc(sim, 4)
  assert.equal(c.ex.fb.sel, '10')
  assert.equal(c.ex.aluB, 8) // ALUSrc picks the offset
  assert.equal(c.ex.writeData, 35)
  assert.equal(sim.final.memory[108], 35)
})

test('dependence summary matches what the hardware did', () => {
  const kinds = dependences(example('The slide 53 chain')).map((d) => `${d.consumer}:${d.resolution.kind}`)
  assert.deepEqual(kinds, ['1:exmem', '2:memwb', '3:regfile-same', '3:regfile-same', '4:regfile'])
})

test('steps: edge, 1st half, 2nd half, EX+MEM, skipping empty ones', () => {
  const sim = example('Load-use hazard (slides 67–74)')
  const steps = buildSteps(sim)
  assert.deepEqual(steps.filter((s) => s.cycle === 0).map((s) => s.phase), ['edge', 'id'])
  assert.deepEqual(steps.filter((s) => s.cycle === 4).map((s) => s.phase), ['edge', 'wb', 'id', 'ex'])
  const stall = explain(sim, { cycle: 2, phase: 'id' })
  assert.equal(stall.tone, 'hazard')
  assert.match(stall.lines.map((l) => l.text).join(' '), /PCWrite = 0/)
  const fwd = explain(sim, { cycle: 4, phase: 'ex' })
  assert.equal(fwd.tone, 'forward')
  for (const s of steps) assert.ok(explain(sim, s).lines.length > 0)
})

test('rejects what is not in the slide datapath', () => {
  for (const code of ['beq $1,$2,L', 'L: add $1,$2,$3', 'andi $1,$2,3', 'addu $1,$2,$3', 'add $32,$1,$2', 'addi $1,$2', 'addi $1,$2,40000', 'nop $1', '', 'lw $1, 4']) {
    assert.throws(() => run(code), undefined, code)
  }
  assert.throws(() => run('lw $1, 2($zero)'), /Cycle 4.*not a multiple of 4/)
  assert.throws(() => parseInitial('$zero=1', ''))
  assert.throws(() => parseInitial('', '3=5'))
})

test('random programs end in the same state as a one-at-a-time interpreter', () => {
  let seed = 2026
  const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
  for (let trial = 0; trial < 150; trial++) {
    const regs = Array.from({ length: 32 }, (_, i) => (i === 0 ? 0 : random(100) - 50))
    regs[20] = 256
    const memory = { 256: random(100), 260: random(100), 264: random(100) }
    const R = [...regs], Mem = { ...memory }, code = []
    for (let j = 0; j < 20; j++) {
      const op = random(8), d = random(8), a = random(8), b = random(8), off = random(3) * 4
      if (op === 0) { code.push(`add $${d},$${a},$${b}`); R[d] = (R[a] + R[b]) | 0 }
      if (op === 1) { code.push(`sub $${d},$${a},$${b}`); R[d] = (R[a] - R[b]) | 0 }
      if (op === 2) { code.push(`and $${d},$${a},$${b}`); R[d] = R[a] & R[b] }
      if (op === 3) { code.push(`slt $${d},$${a},$${b}`); R[d] = R[a] < R[b] ? 1 : 0 }
      if (op === 4) { code.push(`lw $${d},${off}($20)`); R[d] = Mem[256 + off] }
      if (op === 5) { code.push(`sw $${a},${off}($20)`); Mem[256 + off] = R[a] }
      if (op === 6) { code.push(`addi $${d},$${a},-3`); R[d] = (R[a] - 3) | 0 }
      if (op === 7) { code.push(`nor $${d},$${a},$${b}`); R[d] = ~(R[a] | R[b]) }
      R[0] = 0
    }
    const sim = simulate(parseProgram(code.join('\n')), regs, memory)
    assert.deepEqual(sim.final.regs, R, `registers, trial ${trial}`)
    assert.deepEqual(sim.final.memory, Mem, `memory, trial ${trial}`)
  }
})
