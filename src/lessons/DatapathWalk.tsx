import { useState } from 'react'
import { Step } from '../components/Step'
import { Tex } from '../components/Tex'
import { CONTROL_LINES, SingleCycleDatapath, type PartId } from '../datapath/SingleCycleDatapath'
import { COLORS, type Look } from '../datapath/shapes'

type Instr = 'add' | 'lw' | 'sw' | 'beq' | 'addi' | 'j'
type Sig = 'RegDst' | 'Jump' | 'Branch' | 'MemRead' | 'MemtoReg' | 'ALUOp' | 'MemWrite' | 'ALUSrc' | 'RegWrite'

// ---------- which hardware each instruction actually uses ----------

const FETCH: PartId[] = ['pc', 'pcout', 'imem', 'instrOut', 'instrBus', 'instrCtrl', 'control', 'pcToAdd', 'four', 'addpc', 'pc4main']
const NEXT_SEQ: PartId[] = ['pc4ToBmux', 'bmux', 'bmuxout', 'jmux', 'nextpc']
const ALU_CORE: PartId[] = ['rs', 'regs', 'rd1', 'alu', 'aluB', 'alusrc', 'funct', 'aluctl', 'aluctlOut']
const IMM: PartId[] = ['imm', 'signext', 'sext', 'sextAlu']

const ACTIVE: Record<Instr, PartId[]> = {
  add: [...FETCH, ...NEXT_SEQ, ...ALU_CORE, 'rt', 'rd2', 'rd', 'regdst', 'wreg', 'alures', 'aluresWb', 'memtoreg', 'wb'],
  lw: [...FETCH, ...NEXT_SEQ, ...ALU_CORE, ...IMM, 'rt', 'rtMux', 'regdst', 'wreg', 'alures', 'dmem', 'memdata', 'memtoreg', 'wb'],
  sw: [...FETCH, ...NEXT_SEQ, ...ALU_CORE, ...IMM, 'rt', 'rd2', 'rd2mem', 'alures', 'dmem'],
  beq: [
    ...FETCH, ...ALU_CORE, 'rt', 'rd2', 'zero', 'and', 'pcsrc',
    'imm', 'signext', 'sext', 'sl2b', 'sl2bout', 'pc4ToBadd', 'badd', 'btarget', 'pc4ToBmux', 'bmux', 'bmuxout', 'jmux', 'nextpc',
  ],
  addi: [...FETCH, ...NEXT_SEQ, ...ALU_CORE, ...IMM, 'rt', 'rtMux', 'regdst', 'wreg', 'alures', 'aluresWb', 'memtoreg', 'wb'],
  j: [...FETCH, 'instr25', 'sl2j', 'pc4hi', 'jaddr', 'jmux', 'nextpc'],
}

// Values from Part 2 slide 51 (R-type, lw, sw, beq) and slide 31 (Jump); addi added.
const SIGNALS: Record<Instr, Record<Sig, string>> = {
  add: { RegDst: '1', Jump: '0', Branch: '0', MemRead: '0', MemtoReg: '0', ALUOp: '10', MemWrite: '0', ALUSrc: '0', RegWrite: '1' },
  lw: { RegDst: '0', Jump: '0', Branch: '0', MemRead: '1', MemtoReg: '1', ALUOp: '00', MemWrite: '0', ALUSrc: '1', RegWrite: '1' },
  sw: { RegDst: 'X', Jump: '0', Branch: '0', MemRead: '0', MemtoReg: 'X', ALUOp: '00', MemWrite: '1', ALUSrc: '1', RegWrite: '0' },
  beq: { RegDst: 'X', Jump: '0', Branch: '1', MemRead: '0', MemtoReg: 'X', ALUOp: '01', MemWrite: '0', ALUSrc: '0', RegWrite: '0' },
  addi: { RegDst: '0', Jump: '0', Branch: '0', MemRead: '0', MemtoReg: '0', ALUOp: '00', MemWrite: '0', ALUSrc: '1', RegWrite: '1' },
  j: { RegDst: 'X', Jump: '1', Branch: 'X', MemRead: 'X', MemtoReg: 'X', ALUOp: 'XX', MemWrite: '0', ALUSrc: 'X', RegWrite: '0' },
}

const GROUPS: { type: string; note: string; items: { id: Instr; asm: string }[] }[] = [
  { type: 'R-type', note: 'op = 0', items: [{ id: 'add', asm: 'add $t2, $t0, $t1' }] },
  {
    type: 'I-type',
    note: 'op = own number',
    items: [
      { id: 'lw', asm: 'lw $t0, 8($s1)' },
      { id: 'sw', asm: 'sw $t0, 8($s1)' },
      { id: 'beq', asm: 'beq $t0, $t1, L' },
      { id: 'addi', asm: 'addi $t0, $s1, -5' },
    ],
  },
  { type: 'J-type', note: 'op = 2', items: [{ id: 'j', asm: 'j L' }] },
]

// Step-by-step trace with example numbers. "given" says where the inputs come from.
const TRACE: Record<Instr, { given: string; lines: string[] }> = {
  add: {
    given: 'Assume $t0 = 5, $t1 = 7.',
    lines: [
      'rs = $t0 (8) → Read register 1 → Read data 1 = 5',
      'rt = $t1 (9) → Read register 2 → Read data 2 = 7',
      'RegDst = 1 → Write register = rd = $t2 (10)',
      'ALUSrc = 0 → ALU 2nd input = Read data 2 = 7',
      'ALUOp 10 + funct 100000 → ALU control 0010 (add): 5 + 7 = 12',
      'MemRead = 0, MemWrite = 0 → data memory does nothing',
      'MemtoReg = 0 → Write data = ALU result = 12; RegWrite = 1 → $t2 = 12',
      'PC = PC + 4',
    ],
  },
  lw: {
    given: 'Assume $s1 = 1000 and Mem[1008] = 42.',
    lines: [
      'rs = $s1 (17) → Read data 1 = 1000',
      'rt = $t0 (8); RegDst = 0 → Write register = rt = $t0',
      'imm = 8 → sign-extend → 8; ALUSrc = 1 → ALU 2nd input = 8',
      'ALUOp 00 → ALU control 0010 (add): 1000 + 8 = 1008 (an address)',
      'MemRead = 1 → Read data = Mem[1008] = 42',
      'MemtoReg = 1 → Write data = 42; RegWrite = 1 → $t0 = 42',
      'PC = PC + 4',
    ],
  },
  sw: {
    given: 'Assume $s1 = 1000 and $t0 = 42.',
    lines: [
      'rs = $s1 → Read data 1 = 1000',
      'rt = $t0 → Read data 2 = 42 (rt is a SOURCE here: the data to store)',
      'imm = 8 → sign-extend → 8; ALUSrc = 1 → ALU: 1000 + 8 = 1008',
      'Read data 2 (42) → data memory Write data; MemWrite = 1 → Mem[1008] = 42',
      'RegWrite = 0 → no register changes, so RegDst = X and MemtoReg = X',
      'PC = PC + 4',
    ],
  },
  beq: {
    given: 'Assume $t0 = 5, $t1 = 5, PC = 64, offset field = 3.',
    lines: [
      'rs = $t0 → Read data 1 = 5; rt = $t1 → Read data 2 = 5',
      'ALUSrc = 0 → ALU 2nd input = Read data 2 = 5',
      'ALUOp 01 → ALU control 0110 (subtract): 5 − 5 = 0 → Zero = 1',
      'Branch = 1 and Zero = 1 → PCSrc = 1',
      'Branch target = (64 + 4) + 3 × 4 = 80 → PC = 80',
      'If $t1 were 6: 5 − 6 ≠ 0 → Zero = 0 → PCSrc = 0 → PC = 68',
      'RegWrite = 0, MemWrite = 0 → nothing is stored anywhere',
    ],
  },
  addi: {
    given: 'Assume $s1 = 1000. (addi is not in the slide table; it is lw without the memory step.)',
    lines: [
      'rs = $s1 → Read data 1 = 1000',
      'rt = $t0; RegDst = 0 → Write register = rt = $t0 (rt is the DESTINATION)',
      'imm = −5 → sign-extend → 0xFFFFFFFB (still −5); ALUSrc = 1',
      'ALUOp 00 → add: 1000 + (−5) = 995',
      'MemtoReg = 0 → Write data = 995; RegWrite = 1 → $t0 = 995',
      'PC = PC + 4',
    ],
  },
  j: {
    given: 'Assume PC = 0x00000040, address field = 0x0100006.',
    lines: [
      'Bits 25:0 → Shift left 2 → 0x0400018 (28 bits)',
      'PC + 4 = 0x00000044 → its top 4 bits = 0000',
      'Jump address = 0000 + 0x0400018 = 0x00400018',
      'Jump = 1 → jump mux picks it → PC = 0x00400018',
      'RegWrite = 0, MemWrite = 0; the ALU and data memory are not used',
    ],
  },
}

// ---------- explanation steps → hardware to highlight ----------

const STEP_PARTS: Record<number, PartId[]> = {
  1: ['pc', 'pcout', 'imem', 'instrOut'],
  2: ['instrOut', 'instrBus', 'instrCtrl', 'control', 'rs', 'rt', 'rtMux', 'rd', 'imm', 'funct', 'instr25'],
  3: ['rs', 'rt', 'regs', 'rd1', 'rd2', 'rtMux', 'rd', 'regdst', 'wreg', 'ctrl_RegDst'],
  4: ['imm', 'signext', 'sext', 'sextAlu', 'rd2', 'alusrc', 'aluB', 'ctrl_ALUSrc'],
  5: ['rd1', 'aluB', 'alu', 'funct', 'aluctl', 'aluctlOut', 'ctrl_ALUOp', 'zero', 'alures'],
  6: ['alures', 'dmem', 'rd2mem', 'memdata', 'ctrl_MemRead', 'ctrl_MemWrite'],
  7: ['memdata', 'aluresWb', 'memtoreg', 'wb', 'ctrl_MemtoReg', 'ctrl_RegWrite', 'regs'],
  8: ['pcToAdd', 'four', 'addpc', 'pc4main', 'pc4ToBmux', 'pc4ToBadd', 'badd', 'btarget', 'bmux', 'jmux', 'bmuxout', 'jaddr', 'sl2j', 'nextpc', 'and', 'pcsrc'],
}

const SIG_ORDER: Sig[] = ['RegDst', 'ALUSrc', 'ALUOp', 'Branch', 'MemRead', 'MemWrite', 'RegWrite', 'MemtoReg', 'Jump']

export function DatapathWalk() {
  const [instr, setInstr] = useState<Instr>('add')
  const [step, setStep] = useState<number | null>(null)
  const [fade, setFade] = useState(true)

  const sig = SIGNALS[instr]
  const active = new Set<PartId>(step ? STEP_PARTS[step] : ACTIVE[instr])
  const ctrlValue = new Map(CONTROL_LINES.map((c) => [c.id, sig[c.name as Sig]]))

  const look = (id: PartId): Look => {
    if (step) return active.has(id) ? 'chosen' : 'normal'
    const v = ctrlValue.get(id)
    if (v !== undefined) {
      if (v === 'X' || v === 'XX') return fade ? 'faded' : 'normal'
      if (v.includes('1') || id === 'ctrl_ALUOp') return 'chosen'
      return 'normal'
    }
    if (active.has(id)) return 'chosen'
    return fade ? 'faded' : 'normal'
  }

  // Control values written next to each control line label.
  const overlay = step ? null : (
    <g fontFamily="Consolas, ui-monospace, monospace" fontWeight={700} fontSize={23}>
      {CONTROL_LINES.map((c) => {
        const v = sig[c.name as Sig]
        const col = v === 'X' || v === 'XX' ? 'var(--dont-care)' : v.includes('1') ? COLORS.chosen : COLORS.ctrl
        return (
          <text key={c.id} x={790} y={c.y - 10} fill={col} stroke="white" strokeWidth={5} paintOrder="stroke">
            = {v}
          </text>
        )
      })}
    </g>
  )

  const asm = GROUPS.flatMap((g) => g.items).find((i) => i.id === instr)!.asm

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="crumb">Chapter 4 · Part 1 · slides 12–30 · Part 2 slide 51</p>
          <h1>One instruction through the datapath</h1>
          <p className="lede">
            Fetch → split into fields → read registers → ALU → data memory → write back, all in one clock cycle.
            Pick an R-, I- or J-type instruction to see exactly which parts it uses and every control signal's value.
          </p>
        </div>
      </header>

      <div className="layout">
        <section className="diagram-col">
          <div className="diagram-card">
            <SingleCycleDatapath look={look} overlay={overlay} />
          </div>
          <div className="legend">
            <span><i style={{ background: COLORS.chosen }} />{step ? `step ${step}` : `used by ${asm}`}</span>
            <span><i style={{ background: COLORS.ctrl }} />control signal = 0 (still matters)</span>
            {!step && fade && <span><i style={{ background: COLORS.faded }} />not used / X (doesn't matter)</span>}
          </div>

          <h2>The full explanation</h2>
          <p className="hint">Your explanation, corrected and completed. Click a step to highlight its hardware.</p>
          <ol className="steps">
            <Step n={1} cur={step} set={setStep} title="Fetch the instruction">
              <p>The PC sends its address to the instruction memory's <b>Read address</b>. The memory outputs the 32-bit instruction (<b>Instruction [31–0]</b>).</p>
            </Step>
            <Step n={2} cur={step} set={setStep} title="Split the instruction into fields (only wires)">
              <p>Every field goes out on its own wires <b>every cycle</b>, whether this instruction needs it or not:</p>
              <ul>
                <li>[31–26] opcode → <b>Control</b>, which makes all the control signals.</li>
                <li>[25–21] <b>rs</b> → Read register 1.</li>
                <li>[20–16] <b>rt</b> → Read register 2, <i>and</i> input 0 of the RegDst mux.</li>
                <li>[15–11] <b>rd</b> → input 1 of the RegDst mux.</li>
                <li>[15–0] immediate → Sign-extend. [5–0] <b>funct</b> → ALU control.</li>
                <li>[25–0] → Shift left 2 for the jump address. This also happens for every instruction, not only <code>j</code>; only the Jump mux decides whether it is used.</li>
              </ul>
            </Step>
            <Step n={3} cur={step} set={setStep} title="Read the registers and choose the destination">
              <ul>
                <li><b>Read data 1</b> = value of Source 1 (register named by rs). <b>Read data 2</b> = value of Source 2 (register named by rt).</li>
                <li>The <b>RegDst</b> mux picks which field names the <b>Write register</b>: 1 → rd (R-type), 0 → rt (<code>lw</code>, <code>addi</code>).</li>
                <li><code>sw</code> and <code>beq</code> write no register, so RegDst = X. In <code>sw</code>, rt is a <b>source</b> (the value to store), not a destination.</li>
              </ul>
            </Step>
            <Step n={4} cur={step} set={setStep} title="Choose the ALU's second input">
              <ul>
                <li>The 16-bit immediate is <b>sign-extended</b> to 32 bits first (a negative offset stays negative).</li>
                <li>The <b>ALUSrc</b> mux: 0 → Read data 2 (R-type, <code>beq</code>); 1 → sign-extended immediate (<code>lw</code>, <code>sw</code>, <code>addi</code>).</li>
                <li>The ALU's first input is always Read data 1.</li>
              </ul>
            </Step>
            <Step n={5} cur={step} set={setStep} title="The ALU computes">
              <ul>
                <li><b>ALU control</b> combines ALUOp (2 bits from Control) with funct (bits 5–0) into a 4-bit operation: add for <code>lw</code>/<code>sw</code> (address), subtract for <code>beq</code> (compare), and whatever funct says for R-type.</li>
                <li>Two outputs: <b>ALU result</b> (32 bits: a value or a memory address) and <b>Zero</b> (1 bit, = 1 when the result is 0).</li>
                <li>Zero is <b>not</b> a result value. It is a flag used by <code>beq</code> through the AND gate. Jumps don't use the ALU at all.</li>
              </ul>
            </Step>
            <Step n={6} cur={step} set={setStep} title="Data memory (load and store only)">
              <ul>
                <li>ALU result → <b>Address</b>. Read data 2 → <b>Write data</b> (so <code>sw</code> stores Source 2's value).</li>
                <li><b>MemRead</b> = 1 (<code>lw</code>): memory outputs the word at that address on <b>Read data</b>.</li>
                <li><b>MemWrite</b> = 1 (<code>sw</code>): memory stores Write data at that address.</li>
                <li>Load = memory → register. Store = register → memory.</li>
              </ul>
            </Step>
            <Step n={7} cur={step} set={setStep} title="Write back into the register file">
              <ul>
                <li>The <b>MemtoReg</b> mux picks what is written: 1 → Read data from memory (<code>lw</code>); 0 → ALU result (R-type, <code>addi</code>). On the slide the 1 is on top.</li>
                <li>Its output loops back along the bottom wire to the register file's <b>Write data</b>.</li>
                <li><b>RegWrite</b> = 1 lets the write happen, at the <b>end of the cycle</b> (clock edge). For <code>sw</code>, <code>beq</code> and <code>j</code>, RegWrite = 0.</li>
                <li>Don't confuse them: <b>MemRead</b> tells memory to read; <b>MemtoReg</b> is the mux's select line.</li>
              </ul>
            </Step>
            <Step n={8} cur={step} set={setStep} title="Meanwhile: the next PC">
              <p>In parallel, PC + 4, the branch target and the jump address are all computed, and two muxes pick one (see the section above). The PC is updated at the same clock edge.</p>
              <Tex block>{String.raw`\text{whole instruction} = \text{one clock cycle} \;\Rightarrow\; T_{\text{clock}} \ge \text{delay of the slowest instruction (lw)}`}</Tex>
            </Step>
          </ol>

          <div className="exam">
            <h3>In past papers</h3>
            <ul>
              <li><b>2016-17 Q2(c)</b> Describe the datapath for R-type instructions → steps 1–5 and 7 with <code>add</code> selected.</li>
              <li><b>2016-17 Q2(e)</b> What are the two inputs of the ALU mux? <span className="ans">Read data 2 (input 0) and the sign-extended lower 16 bits (input 1), chosen by ALUSrc.</span></li>
              <li><b>2020-21 Q3</b> Highlight the active elements for <code>ori</code> and say which control bits are set. <span className="ans">Like <code>addi</code> here, but the ALU must do OR and the immediate must be <i>zero</i>-extended, so ALUOp needs a new code.</span></li>
              <li><b>2019-20 Q8(a)</b> Control values for <code>add</code>, <code>sw</code>, <code>beq</code> → the "Control signals" box on the right.</li>
              <li><b>2011-12 Q3(b)</b> Purpose of the ALU for R-type, load/store and branch. <span className="ans">The arithmetic result / the memory address / the comparison (via Zero).</span></li>
              <li><b>2023-24 Q8(a)(iv)</b> Can one memory serve both instructions and data in single-cycle? <span className="ans">No: in the same cycle you fetch the instruction <i>and</i> access data (lw/sw), and each unit can do only one thing per cycle.</span></li>
            </ul>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-block">
            <h3>Pick an instruction</h3>
            {GROUPS.map((g) => (
              <div key={g.type} className="igroup">
                <div className="itype">{g.type} <small>{g.note}</small></div>
                <div className="ibtns">
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      className={instr === it.id && !step ? 'on' : ''}
                      onClick={() => { setInstr(it.id); setStep(null) }}
                    >
                      <code>{it.asm}</code>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {step && <button className="link" onClick={() => setStep(null)}>← back to the instruction view (step {step} is shown)</button>}
          </div>

          <div className="panel-block">
            <h3>Control signals</h3>
            <div className="sigs nine">
              {SIG_ORDER.map((n) => (
                <div key={n} className={'sig ' + (sig[n].includes('1') ? 'one' : sig[n].startsWith('X') ? 'x' : '')}>
                  <span>{n}</span>
                  <b>{sig[n]}</b>
                </div>
              ))}
            </div>
            <p className="tiny">X = doesn't matter (what it selects is never used). Values from Part 2 slide 51; Jump from slide 31.</p>
          </div>

          <div className="panel-block">
            <h3>Trace: <code>{asm}</code></h3>
            <p className="given">{TRACE[instr].given}</p>
            <ol className="trace">
              {TRACE[instr].lines.map((l, i) => <li key={i}>{l}</li>)}
            </ol>
          </div>

          <div className="panel-block">
            <h3>View</h3>
            <label className="tog"><input type="checkbox" checked={fade} onChange={(e) => setFade(e.target.checked)} /> Fade parts this instruction doesn't use</label>
          </div>
        </aside>
      </div>
    </div>
  )
}
