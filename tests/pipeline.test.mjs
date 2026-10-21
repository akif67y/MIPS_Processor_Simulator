import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProgram, parseInitial, simulate } from '../src/pipeline/engine.ts'
import { EXAMPLES } from '../src/pipeline/examples.ts'

const run = (code, registers = '$t0=256, $t1=7, $t2=3', memory = '256=9, 260=13') => {
  const initial = parseInitial(registers, memory)
  return simulate(parseProgram(code), initial.regs, initial.memory)
}
const at = (sim, cycle, half = 0) => sim.frames[(cycle - 1) * 2 + half]

test('all supplied examples execute with n+4+stalls cycles', () => {
  for (const e of EXAMPLES) {
    const sim = run(e.code, e.registers, e.memory)
    assert.equal(sim.frames.length / 2, sim.program.length + 4 + sim.stalls, e.name)
    assert.equal(sim.final.regs[0], 0)
  }
})
test('adjacent ALU result forwards independently to A and B', () => {
  const sim = run('add $s1,$t1,$t2\nadd $s2,$s1,$s1')
  assert.equal(sim.stalls, 0)
  assert.equal(at(sim, 4).signals.a.select, '10')
  assert.equal(at(sim, 4).signals.b.select, '10')
  assert.equal(sim.final.regs[18], 20)
})
test('one-gap producer forwards MEM/WB to both inputs', () => {
  const sim = run('add $s1,$t1,$t2\nnop\nadd $s2,$s1,$s1')
  assert.equal(at(sim, 5).signals.a.select, '01')
  assert.equal(at(sim, 5).signals.b.select, '01')
  assert.equal(sim.final.regs[18], 20)
})
test('different producers can forward to A and B simultaneously', () => {
  const sim = run('add $s1,$t1,$t2\nsub $s2,$t1,$t2\nadd $s3,$s1,$s2')
  assert.equal(at(sim, 5).signals.a.select, '01')
  assert.equal(at(sim, 5).signals.b.select, '10')
  assert.equal(sim.final.regs[19], 14)
})
test('EX/MEM wins a double data hazard (slide 63)', () => {
  const e = EXAMPLES[5], sim = run(e.code, e.registers, e.memory)
  assert.equal(at(sim, 5).signals.a.priority, true)
  assert.equal(at(sim, 5).signals.a.value, 60)
  assert.equal(sim.final.regs[1], 64)
})
test('load-use holds PC and IF/ID, zeros controls, and drains a bubble', () => {
  const sim = run('lw $s1,0($t0)\nadd $s2,$s1,$s1\nadd $s3,$s2,$s1')
  const c3 = at(sim, 3), c4 = at(sim, 4), c5 = at(sim, 5)
  assert.equal(sim.stalls, 1)
  assert.equal(c3.signals.matchA, true)
  assert.equal(c3.signals.matchB, true)
  assert.equal(c4.state.pc, c3.state.pc)
  assert.deepEqual(c4.state.ifid, c3.state.ifid)
  assert.equal(c4.state.idex.bubble, 1)
  assert.ok(Object.values(c4.state.idex.control).every(v => v === 0 || v === '0' || v === '00'))
  assert.equal(c4.state.exmem.ins.op, 'lw')
  assert.equal(c5.signals.a.select, '01')
  assert.equal(at(sim, 5).state.exmem.bubble, 1)
  assert.equal(at(sim, 6).state.memwb.bubble, 1)
  assert.equal(sim.final.regs[18], 18)
  assert.equal(sim.final.regs[19], 27)
})
test('WB writes between halves before ID samples; rewind snapshots stay immutable', () => {
  const sim = run('add $s1,$t1,$t2\nnop\nnop\nadd $s2,$s1,$s1')
  assert.equal(at(sim, 5).state.regs[17], 0)
  assert.equal(at(sim, 5, 1).state.regs[17], 10)
  assert.equal(at(sim, 5, 1).signals.decodeA, 10)
  assert.equal(at(sim, 6).state.idex.a, 10)
  assert.equal(at(sim, 6).signals.a.select, '00')
  assert.equal(sim.final.regs[18], 20)
})
test('load to store data uses late MEM bypass without a stall', () => {
  const sim = run('lw $s1,0($t0)\nsw $s1,4($t0)')
  assert.equal(sim.stalls, 0)
  assert.equal(at(sim, 4).signals.b.pending, true)
  assert.equal(at(sim, 5).signals.storeForward, true)
  assert.equal(at(sim, 5, 1).state.memory[260], 13)
  assert.equal(at(sim, 6).state.memory[260], 9)
})
test('newer pending load must not let an older writer supply store data', () => {
  const sim = run('addi $s1,$zero,99\nlw $s1,0($t0)\nsw $s1,4($t0)')
  assert.equal(at(sim, 5).signals.b.pending, true)
  assert.equal(at(sim, 6).signals.store, 9)
  assert.equal(sim.final.memory[260], 9)
})
test('store base hazards stall; store data and immediate remain separate', () => {
  const sim = run('lw $s1,0($t0)\nsw $t1,4($s1)', undefined, '256=512')
  assert.equal(sim.stalls, 1)
  assert.equal(sim.final.memory[516], 7)
  const aluStore = run('add $s1,$t1,$t2\nsw $s1,4($t0)')
  assert.equal(at(aluStore, 4).signals.b.value, 10)
  assert.equal(at(aluStore, 4).signals.aluB, 4)
  assert.equal(aluStore.final.memory[260], 10)
})
test('register aliases, zero writes and immediate destinations do not create false hazards', () => {
  const sim = run('lw $9,0($8)\naddi $t1,$zero,5\nadd $0,$t1,$t1\nadd $s1,$zero,$t1')
  assert.equal(sim.stalls, 0)
  assert.equal(sim.final.regs[0], 0)
  assert.equal(sim.final.regs[17], 5)
  assert.equal(at(sim, 6).signals.a.select, '00')
})
test('signed and unsigned operations, logical immediates and wraparound', () => {
  const sim = run('addi $1,$zero,-1\nslt $2,$1,$zero\nsltu $3,$1,$zero\nandi $4,$1,65535\naddiu $5,$1,1')
  assert.deepEqual(sim.final.regs.slice(1, 6), [-1, 1, 0, 65535, 0])
})
test('reject malformed programs, unsupported control flow and unaligned accesses', () => {
  for (const code of ['add $32,$1,$2', 'addi $1,$2', 'lw $1,0($2),$3', 'addi $1,$2,32768', 'beq $1,$2,target', 'nop $1', '']) assert.throws(() => run(code))
  assert.throws(() => run('lw $1,1($zero)'), /Cycle 4.*unaligned/)
  assert.throws(() => parseInitial('$zero=1', ''))
  assert.throws(() => parseInitial('', '3=5'))
})
test('deterministic randomized programs match an independent sequential interpreter', () => {
  let seed = 1771
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
  for (let trial = 0; trial < 100; trial++) {
    const regs = Array.from({ length: 32 }, (_, i) => i === 0 ? 0 : random(100))
    regs[20] = 256
    const memory = { 256: random(100), 260: random(100), 264: random(100) }
    const expectedRegs = [...regs], expectedMemory = { ...memory }, code = []
    for (let j = 0; j < 40; j++) {
      const op = random(6), dest = random(8), a = random(8), b = random(8), address = random(3) * 4
      if (op === 0) { code.push(`add $${dest},$${a},$${b}`); expectedRegs[dest] = (expectedRegs[a] + expectedRegs[b]) | 0 }
      if (op === 1) { code.push(`sub $${dest},$${a},$${b}`); expectedRegs[dest] = (expectedRegs[a] - expectedRegs[b]) | 0 }
      if (op === 2) { code.push(`and $${dest},$${a},$${b}`); expectedRegs[dest] = expectedRegs[a] & expectedRegs[b] }
      if (op === 3) { code.push(`lw $${dest},${address}($20)`); expectedRegs[dest] = expectedMemory[256 + address] }
      if (op === 4) { code.push(`sw $${a},${address}($20)`); expectedMemory[256 + address] = expectedRegs[a] }
      if (op === 5) { code.push(`addi $${dest},$${a},-3`); expectedRegs[dest] = (expectedRegs[a] - 3) | 0 }
      expectedRegs[0] = 0
    }
    const result = simulate(parseProgram(code.join('\n')), regs, memory)
    assert.deepEqual(result.final.regs, expectedRegs, `registers in trial ${trial}`)
    assert.deepEqual(result.final.memory, expectedMemory, `memory in trial ${trial}`)
  }
})
