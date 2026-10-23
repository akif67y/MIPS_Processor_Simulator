import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProgram, parseInitial, simulate, branchRuns, ZERO_CONTROLS } from '../src/pipeline/engine.ts'
import { buildSteps, explain } from '../src/pipeline/explain.ts'
import { BRANCH_EXAMPLES } from '../src/pipeline/branchExamples.ts'
import { nestedLoop, parseOutcomes, runPredictor, cost } from '../src/pipeline/predictor.ts'

const HW = [
  { branch: 'mem', policy: 'predict' }, { branch: 'mem', policy: 'stall' },
  { branch: 'id', policy: 'predict' }, { branch: 'id', policy: 'stall' }, { branch: 'id', policy: 'delayed' },
]
const run = (code, registers = '', memory = '', hw = { branch: 'id', policy: 'predict' }) => {
  const init = parseInitial(registers, memory)
  return simulate(parseProgram(code, { branches: true }), init.regs, init.memory, hw)
}
const example = (name, hw) => {
  const e = BRANCH_EXAMPLES.find((x) => x.name === name)
  assert.ok(e, name)
  return run(e.code, e.registers, e.memory, hw ?? e.hw)
}
const cyc = (sim, n) => sim.cycles[n - 1]
const text = (p) => (!p ? null : p.squashed ? `x ${p.squashed.instr.text}` : p.bubble ? 'bubble' : p.instr.text)

test('parsing: labels, slide-78 addresses, gaps of nop, word offsets', () => {
  const p = parseProgram('36: sub $10, $4, $8\n40: beq $1, $3, 7\n44: and $12, $2, $5\n56: slt $15, $6, $7\n72: lw $4, 50($7)', { branches: true })
  assert.deepEqual(p.map((i) => i.addr), [36, 40, 44, 48, 52, 56, 60, 64, 68, 72])
  assert.equal(p[1].target, 72)
  assert.equal(p[1].word, 0x10230007)
  assert.equal(p.filter((i) => i.filler).length, 5)
  const q = parseProgram('loop: addi $t0, $t0, -1\nbne $t0, $zero, loop\nexit:', { branches: true })
  assert.equal(q[1].imm, -2)
  assert.equal(q[1].target, 0)
  assert.deepEqual(q[0].labels, ['loop'])
  for (const bad of ['beq $1, $2, nowhere', 'beq $1, $2, 100', 'x: add $1,$2,$3\nx: add $1,$2,$3', 'j loop', '8: add $1,$2,$3\n4: add $1,$2,$3']) {
    assert.throws(() => parseProgram(bad, { branches: true }), undefined, bad)
  }
  // the data-hazard lab still has no branches or labels
  assert.throws(() => parseProgram('beq $1, $2, 3'), /next lesson/)
  assert.throws(() => parseProgram('L: add $1, $2, $3'), /Labels/)
})

test('slide 77: decided in MEM, a taken branch flushes three instructions', () => {
  const sim = example('Taken: flush three instructions')
  assert.equal(sim.cycles.length, 10)
  assert.equal(sim.flushes, 3)
  const c5 = cyc(sim, 5)
  assert.equal(c5.branch.at, 'mem')
  assert.equal(c5.branch.taken, true)
  assert.equal(c5.branch.target, 72)
  assert.deepEqual(c5.squash, { ifid: true, idex: true, exmem: true, why: 'flush' })
  const c6 = cyc(sim, 6)
  assert.equal(c6.at.pc, 72)
  assert.equal(c6.fetch.instr.text, 'lw  $4, 50($7)')
  // IF.Flush: the word becomes 0 = nop; ID.Flush / EX.Flush: all controls 0
  assert.equal(c6.at.ifid.instr.word, 0)
  assert.equal(c6.at.ifid.squashed.instr.text, 'add $14, $4, $2')
  assert.deepEqual(c6.at.idex.ctrl, ZERO_CONTROLS)
  assert.equal(c6.at.idex.squashed.instr.text, 'or  $13, $2, $6')
  assert.deepEqual(c6.at.exmem.ctrl, ZERO_CONTROLS)
  assert.equal(c6.at.exmem.squashed.instr.text, 'and $12, $2, $5')
  // nothing on the wrong path wrote anything
  assert.equal(sim.final.regs[12], 0)
  assert.equal(sim.final.regs[13], 0)
  assert.equal(sim.final.regs[14], 0)
  assert.equal(sim.final.regs[4], 77)
})

test('slide 78: decided in ID, a taken branch flushes one instruction', () => {
  const sim = example('Slide 78: taken, flush one')
  assert.equal(sim.cycles.length, 8)
  assert.equal(sim.flushes, 1)
  const c3 = cyc(sim, 3)
  assert.equal(c3.branch.at, 'id')
  assert.equal(c3.branch.target, 72)
  assert.equal(c3.pcSrc, 1)
  assert.deepEqual(c3.squash, { ifid: true, idex: false, exmem: false, why: 'flush' })
  assert.equal(cyc(sim, 4).fetch.pc, 72)
  assert.equal(text(cyc(sim, 4).at.idex), 'beq $1, $3, 7')
})

test('not taken: predict not taken loses nothing', () => {
  for (const hw of [{ branch: 'mem', policy: 'predict' }, { branch: 'id', policy: 'predict' }]) {
    const sim = example('Not taken: nothing lost', hw)
    assert.equal(sim.flushes, 0)
    assert.equal(sim.cycles.length, 5 + sim.completed - 1)
    assert.equal(branchRuns(sim)[0].taken, false)
  }
})

test('slides 26–27: stall on branch costs 3 (MEM) or 1 (ID) cycles, taken or not', () => {
  const mem = example('Stall on branch, decided in MEM')
  const id = example('Stall on branch, decided in ID')
  const predict = example('Predict not taken: correct')
  assert.equal(mem.flushes, 3)
  assert.equal(id.flushes, 1)
  assert.equal(predict.flushes, 0)
  assert.equal(mem.cycles.length, predict.cycles.length + 3)
  assert.equal(id.cycles.length, predict.cycles.length + 1)
  assert.ok(mem.cycles.some((c) => c.waiting && c.squash?.why === 'wait'))
  assert.deepEqual(mem.final.regs, predict.final.regs)
})

test('slide 79: ALU result 2 or 3 before → forwarded to the comparator, no stall', () => {
  const sim = example('ALU result 2 or 3 before: forward')
  assert.equal(sim.stalls, 0)
  const c = sim.cycles.find((x) => x.branch)
  assert.equal(c.branch.fa.sel, 0) // $1: add is in WB, read from the register file
  assert.equal(c.id.sameCycleRs, true)
  assert.equal(c.branch.fb.sel, 1) // $4: add is in MEM, EX/MEM forwarding
  assert.equal(c.branch.b, 5)
  assert.equal(c.branch.taken, true)
})

test('slide 80: ALU right before, or lw two before → one stall', () => {
  for (const name of ['ALU result right before: 1 stall', 'lw 2nd before + ALU right before: 1 stall']) {
    const sim = example(name)
    assert.equal(sim.stalls, 1, name)
    const stall = sim.cycles.find((c) => c.hazard.stall)
    assert.ok(stall.hazard.branch.aluRt, name)
    const c = sim.cycles.find((x) => x.branch)
    assert.equal(c.branch.fb.sel, 1, name)
    assert.equal(c.branch.taken, true, name)
  }
  const both = example('lw 2nd before + ALU right before: 1 stall')
  const s = both.cycles.find((c) => c.hazard.stall).hazard.branch
  assert.equal(s.loadRs, true) // lw $1 in MEM at the same time
})

test('slide 81: lw right before the branch → two stalls', () => {
  const sim = example('lw right before: 2 stalls')
  assert.equal(sim.stalls, 2)
  const [s1, s2] = sim.cycles.filter((c) => c.hazard.stall)
  assert.equal(s1.hazard.loadUse, true)
  assert.equal(s1.hazard.branch.aluRs, true)
  assert.equal(s2.hazard.loadUse, false)
  assert.equal(s2.hazard.branch.loadRs, true)
  const c = sim.cycles.find((x) => x.branch)
  assert.equal(c.id.sameCycleRs, true) // lw in WB: write 1st half, read 2nd half
  assert.equal(c.branch.taken, true)
  // the same program decided in MEM needs only the ordinary load-use stall
  assert.equal(example('lw right before: 2 stalls', { branch: 'mem', policy: 'predict' }).stalls, 1)
})

test('slide 31: delayed branch runs the delay slot and flushes nothing', () => {
  const sim = example('Delay slot filled by the compiler')
  assert.equal(sim.flushes, 0)
  assert.equal(sim.final.regs[4], 30) // add in the slot ran
  assert.equal(sim.final.regs[7], 0) // lw was skipped
  assert.equal(sim.final.regs[9], 30)
  assert.throws(() => example('Delay slot filled by the compiler', { branch: 'mem', policy: 'delayed' }), /needs the branch decided in ID/)
})

test('a taken branch in MEM wins over a load-use stall in the same cycle', () => {
  const sim = example('Load-use stall and flush in one cycle')
  const c = sim.cycles.find((x) => x.branch)
  assert.equal(c.hazard.stall, true)
  assert.equal(c.hazard.overridden, true)
  assert.equal(sim.stalls, 0)
  assert.equal(c.next.pc, c.branch.target)
  assert.equal(sim.final.regs[2], 0)
  assert.equal(sim.final.regs[4], 5)
})

test('loops: one row per iteration, flush per taken iteration, scheduling removes the branch stall', () => {
  const sim = example('Counting loop (bne backward)')
  const runs = branchRuns(sim)
  assert.deepEqual(runs.map((r) => r.taken), [true, true, false])
  assert.deepEqual(runs.map((r) => r.lost), [1, 1, 0])
  assert.deepEqual(runs.map((r) => r.dataStalls), [1, 1, 1])
  assert.equal(sim.final.regs[9], 6)
  const fixed = example('Counting loop, scheduled')
  assert.equal(fixed.stalls, 0)
  assert.equal(fixed.final.regs[9], 6)
  assert.equal(fixed.cycles.length, sim.cycles.length - 3)
  // every fetch of the loop body is its own instance
  const seqs = new Set(sim.cycles.filter((c) => c.fetch.instr?.labels).map((c) => c.fetch.seq))
  assert.equal(seqs.size, 3)
  assert.throws(() => run('loop: beq $0, $0, loop'), /endless loop/)
})

test('every example, every hardware: cycle count adds up and every step is explained', () => {
  for (const e of BRANCH_EXAMPLES) {
    for (const hw of HW) {
      const sim = run(e.code, e.registers, e.memory, hw)
      assert.equal(sim.cycles.length, 4 + sim.completed + sim.stalls + sim.flushes + sim.idle, `${e.name} ${JSON.stringify(hw)}`)
      assert.ok(sim.idle >= 0)
      assert.equal(sim.final.regs[0], 0)
      const steps = buildSteps(sim)
      for (const s of steps) assert.ok(explain(sim, s).lines.length > 0, `${e.name} ${s.cycle}/${s.phase}`)
      for (const c of sim.cycles) if (c.branch || c.waiting) assert.ok(steps.some((s) => s.cycle === c.n - 1 && s.phase === 'br'))
    }
    assert.equal(run(e.code, e.registers, e.memory, e.hw).idle, 0, e.name)
  }
})

/** One instruction at a time, with branches; `delayed` runs the instruction after a branch first. */
function interpret(code, regs0, mem0, delayed) {
  const prog = parseProgram(code, { branches: true })
  const R = [...regs0], M = { ...mem0 }
  const base = prog[0].addr
  let pc = base, steps = 0
  const exec = (i) => {
    const a = R[i.rs], b = R[i.rt]
    if (i.op === 'add') R[i.rd] = (a + b) | 0
    if (i.op === 'sub') R[i.rd] = (a - b) | 0
    if (i.op === 'and') R[i.rd] = a & b
    if (i.op === 'or') R[i.rd] = a | b
    if (i.op === 'slt') R[i.rd] = a < b ? 1 : 0
    if (i.op === 'addi') R[i.rt] = (a + i.imm) | 0
    if (i.op === 'lw') R[i.rt] = M[(a + i.imm) >>> 0] ?? 0
    if (i.op === 'sw') M[(a + i.imm) >>> 0] = b
    R[0] = 0
  }
  while ((pc - base) / 4 < prog.length) {
    if (++steps > 500) throw new Error('runaway')
    const i = prog[(pc - base) / 4]
    if (i.op === 'beq' || i.op === 'bne') {
      const taken = i.op === 'beq' ? R[i.rs] === R[i.rt] : R[i.rs] !== R[i.rt]
      if (delayed) { const slot = prog[(pc - base) / 4 + 1]; if (slot) exec(slot) }
      pc = taken ? i.target : pc + (delayed ? 8 : 4)
    } else { exec(i); pc += 4 }
  }
  return { regs: R, memory: M }
}

test('random programs with branches end in the same state as a one-at-a-time interpreter', () => {
  let seed = 4242
  const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
  for (let trial = 0; trial < 120; trial++) {
    const regs = Array.from({ length: 32 }, (_, i) => (i === 0 ? 0 : random(6) - 2))
    regs[20] = 256
    const memory = { 256: random(4), 260: random(4), 264: random(4) }
    const n = 14
    const lines = []
    for (let j = 0; j < n; j++) {
      const op = random(10), d = 1 + random(6), a = random(7), b = random(7), off = random(3) * 4
      const prevBranch = /^L\d+: b|^b/.test(lines[j - 1] ?? '')
      if (op === 0) lines.push(`add $${d},$${a},$${b}`)
      else if (op === 1) lines.push(`sub $${d},$${a},$${b}`)
      else if (op === 2) lines.push(`and $${d},$${a},$${b}`)
      else if (op === 3) lines.push(`slt $${d},$${a},$${b}`)
      else if (op === 4) lines.push(`lw $${d},${off}($20)`)
      else if (op === 5) lines.push(`sw $${a},${off}($20)`)
      else if (op === 6) lines.push(`addi $${d},$${a},${random(5) - 2}`)
      else if (prevBranch || j >= n - 1) lines.push(`or $${d},$${a},$${b}`)
      else lines.push(`${random(2) ? 'beq' : 'bne'} $${a},$${b},L${j + 2 + random(n - j - 1)}`) // forward only: always ends
    }
    const code = lines.map((l, j) => `L${j}: ${l}`).join('\n') + `\nL${n}:`
    for (const hw of HW) {
      const sim = run(code, regs.map(String).map((v, i) => `$${i}=${v}`).slice(1).join(','), Object.entries(memory).map(([k, v]) => `${k}=${v}`).join(','), hw)
      const ref = interpret(code, regs, memory, hw.policy === 'delayed')
      assert.deepEqual(sim.final.regs, ref.regs, `registers, trial ${trial}, ${JSON.stringify(hw)}\n${code}`)
      assert.deepEqual(sim.final.memory, ref.memory, `memory, trial ${trial}, ${JSON.stringify(hw)}`)
    }
  }
})

test('slides 83–84: 1-bit misses twice per inner loop, 2-bit once', () => {
  const ev = nestedLoop(10, 3)
  const inner = (rows) => rows.filter((r) => r.event.name === 'inner' && !r.correct).length
  // 1-bit starting at "taken": exit of pass 1, then entry + exit of passes 2 and 3
  assert.equal(inner(runPredictor('1bit', ev, 1).rows), 5)
  // 2-bit starting strongly taken: only the three exits
  assert.equal(inner(runPredictor('2bit', ev, 3).rows), 3)
  // textbook worked example: T, T, NT, T
  const tt = parseOutcomes('T T N T')
  assert.equal(runPredictor('2bit', tt, 3).rows.filter((r) => r.correct).length, 3)
  assert.equal(runPredictor('1bit', tt, 1).rows.filter((r) => r.correct).length, 2)
  // slide 85: without a BTB a correctly predicted taken branch still costs 1 cycle; with a BTB hit, 0
  const r = runPredictor('2bit', parseOutcomes('T T'), 3).rows
  assert.equal(cost.noBtb(r[1], 3), 1)
  assert.equal(cost.withBtb(r[0], 3), 1) // first time: BTB miss
  assert.equal(cost.withBtb(r[1], 3), 0)
  assert.equal(cost.staticNotTaken(r[1], 3), 3)
  assert.throws(() => parseOutcomes('T X'))
})

test('whole-cycle view: one step per cycle, five stage cards, nothing lost from the focus steps', async () => {
  const { wholeCycle } = await import('../src/pipeline/explain.ts')
  const { EXAMPLES } = await import('../src/pipeline/examples.ts')
  const sims = [
    ...EXAMPLES.map((e) => { const init = parseInitial(e.registers, e.memory); return simulate(parseProgram(e.code), init.regs, init.memory) }),
    ...BRANCH_EXAMPLES.flatMap((e) => HW.map((hw) => run(e.code, e.registers, e.memory, hw))),
  ]
  for (const sim of sims) {
    const steps = buildSteps(sim, 'whole')
    assert.equal(steps.length, sim.cycles.length)
    sim.cycles.forEach((c, k) => {
      const w = wholeCycle(sim, k)
      assert.deepEqual(w.cards.map((x) => x.stage), ['IF', 'ID', 'EX', 'MEM', 'WB'])
      // every line of the focus steps (except the edge and branch, shown separately) lands in a stage card
      const focus = buildSteps(sim).filter((s) => s.cycle === k && s.phase !== 'edge' && s.phase !== 'br').flatMap((s) => explain(sim, s).lines)
      assert.equal(w.cards.reduce((n, x) => n + x.lines.length, 0), focus.length)
      assert.equal(!!w.branch, !!(c.branch || c.waiting))
      assert.ok(w.title.length > 0)
    })
  }
  // slide 72's stall cycle shows the stall in ID and the re-fetch in IF
  const lu = EXAMPLES.find((e) => e.name.startsWith('Load-use hazard'))
  const init = parseInitial(lu.registers, lu.memory)
  const w = wholeCycle(simulate(parseProgram(lu.code), init.regs, init.memory), 2)
  assert.ok(w.cards[1].badges.some((b) => b.text === 'STALL'))
  assert.ok(w.cards[0].badges.some((b) => /again/.test(b.text)))
  assert.equal(w.tone, 'hazard')
})
