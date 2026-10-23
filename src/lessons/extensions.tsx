// Specs for the "add instruction X" pages (jr, jal, lui, ori, slt).
// New hardware is drawn in green on top of the slide-32 datapath.

import { ctrlEdge, type PartId } from '../datapath/SingleCycleDatapath'
import { Label, MuxN, Oval, Slash, Wire } from '../datapath/shapes'
import type { ExtensionSpec } from './ExtensionPage'

const FETCH: PartId[] = ['pc', 'pcout', 'imem', 'instrOut', 'instrBus', 'instrCtrl', 'control']
const PC4: PartId[] = ['pcToAdd', 'four', 'addpc', 'pc4main']
const NEXT_SEQ: PartId[] = [...PC4, 'pc4ToBmux', 'bmux', 'bmuxout', 'jmux', 'nextpc']
const ALU_RTYPE: PartId[] = ['rs', 'rt', 'regs', 'rd1', 'rd2', 'alusrc', 'aluB', 'alu', 'funct', 'aluctl', 'aluctlOut', 'ctrl_ALUOp', 'alures']
const WRITE_RT: PartId[] = ['rt', 'rtMux', 'regdst', 'wreg', 'ctrl_RegDst', 'ctrl_RegWrite']

/** MemtoReg mux widened to 3 inputs (input 2 is the new value to write). */
function MemtoReg3({ input2 }: { input2: string }) {
  return (
    <g>
      <MuxN x={1397} y={742} w={43} h={178} look="added" inputs={[{ t: '1', y: 762 }, { t: '0', y: 845 }, { t: '2', y: 900 }]} />
      <Label x={1446} y={935} look="added" size={18}>{input2}</Label>
    </g>
  )
}

// ---------------- jr ----------------
export const JR: ExtensionSpec = {
  asm: 'jr rs',
  title: 'Adding jr (jump register)',
  crumb: 'Extending the single-cycle datapath · asked 2022-23 Q3, 2018-19 Q1(a), 2012-13 Q2',
  lede: (
    <>
      <code>jr rs</code> is <b>R-type</b> (op = 0, funct = 8). It does <code>PC ← Reg[rs]</code>: the next PC is the <i>value</i> in a register
      (usually <code>$ra</code>, to return from a function). That value already comes out of the register file as Read data 1.
    </>
  ),
  active: [...FETCH, 'rs', 'regs', 'rd1', 'funct'],
  hidden: ['nextpc'],
  overlay: (
    <g>
      <Wire look="added" pts={[[1435, 180], [1452, 180]]} />
      <Wire look="chosen" pts={[[950, 665], [950, 615], [1444, 615], [1444, 265], [1452, 265]]} dots={[[950, 665]]} />
      <MuxN x={1452} y={150} w={38} h={140} look="added" inputs={[{ t: '0', y: 180 }, { t: '1', y: 265 }]} />
      <Wire look="chosen" pts={[[1490, 220], [1505, 220], [1505, 14], [27, 14], [27, 643], [52, 643]]} />
      <Wire look="chosen" kind="ctrl" arrow={false} pts={[[1471, 322], [1471, 290]]} />
      <text x={1471} y={344} fontSize={19} fontWeight={700} fontFamily="Arial" textAnchor="middle" fill="var(--hw-added)" stroke="white" strokeWidth={5} paintOrder="stroke">JumpReg</text>
      <text x={1180} y={606} fontSize={19} fontFamily="Arial" fill="var(--path-chosen)" stroke="white" strokeWidth={5} paintOrder="stroke">Read data 1 = Reg[rs]</text>
    </g>
  ),
  steps: [
    <><b>Add one 2×1 mux right before the PC</b>, after the jump mux. Input 0 = the old next PC (jump-mux output). Input 1 = <b>Read data 1</b>, i.e. the value of the register named by rs.</>,
    <><b>New control signal <code>JumpReg</code></b> selects it: 1 only for <code>jr</code>.</>,
    <><b>Catch: jr is R-type (op = 0)</b>, so the main Control unit can't tell it apart from <code>add</code> by the opcode. JumpReg must come from <b>funct = 001000</b> (e.g. from the ALU-control logic: op = 0 AND funct = 8).</>,
    <><b>Second catch:</b> Control sets RegWrite = 1 for every op = 0 instruction, but <code>jr</code> must not write a register. So RegWrite must be forced to 0 when JumpReg = 1 (RegWrite<sub>real</sub> = RegWrite · <span style={{ textDecoration: 'overline' }}>JumpReg</span>).</>,
    <>Nothing else is used: no ALU result, no memory and no write back.</>,
  ],
  controls: [['JumpReg', '1', true], ['RegWrite', '0'], ['MemWrite', '0'], ['MemRead', 'X'], ['Branch', 'X'], ['Jump', 'X'], ['RegDst', 'X'], ['ALUSrc', 'X'], ['ALUOp', 'XX'], ['MemtoReg', 'X']],
  notes: [
    <>If the question allows only 2×1 muxes (2022-23 Q3), this design already qualifies: one extra mux.</>,
    <>Write RegWrite = 0 explicitly in your answer. (If it stayed 1, the write would go to rd = 0 = $zero, which hardware ignores, but examiners expect RegWrite = 0.)</>,
  ],
  pyq: [
    <><b>2022-23 Q3</b> beq, bne, j, jr with the fewest 2×1 muxes.</>,
    <><b>2018-19 Q1(a)</b> bne, j, jr, jal, slt, lui.</>,
    <><b>2012-13 Q2</b> bne, j, jr, jal, with control values.</>,
  ],
}

// ---------------- jal ----------------
export const JAL: ExtensionSpec = {
  asm: 'jal label',
  title: 'Adding jal (jump and link)',
  crumb: 'Extending the single-cycle datapath · asked 2018-19 Q1(a), 2012-13 Q2',
  lede: (
    <>
      <code>jal label</code> is <b>J-type</b> (op = 3). It does two things in one cycle: <code>$ra ← PC + 4</code> (save the return address)
      and <code>PC ← jump address</code> (same address as <code>j</code>). $ra is register <b>31</b>.
    </>
  ),
  active: [...FETCH, ...PC4, 'pc4hi', 'instr25', 'sl2j', 'jaddr', 'jmux', 'nextpc', 'ctrl_Jump', 'regs', 'wreg', 'wb', 'ctrl_RegWrite', 'ctrl_MemtoReg'],
  hidden: ['regdst', 'ctrl_RegDst', 'memtoreg'],
  overlay: (
    <g>
      {/* Write-register mux widened: input 2 = constant 31 */}
      <Wire look="added" kind="ctrl" arrow={false} pts={[ctrlEdge(312), [643, 312], [643, 263], [318, 263], [318, 900], [565, 900], [565, 880]]} />
      <Label x={663} y={302} look="added" kind="ctrl">RegDst (2 bits)</Label>
      <Wire look="chosen" pts={[[505, 860], [545, 860]]} />
      <Label x={498} y={868} look="chosen" anchor="end" bold>31</Label>
      <MuxN x={545} y={705} w={40} h={175} look="added" inputs={[{ t: '0', y: 738 }, { t: '1', y: 818 }, { t: '2', y: 860 }]} />
      {/* Write-data mux widened: input 2 = PC + 4 */}
      <MemtoReg3 input2="" />
      <Wire look="chosen" pts={[[1375, 900], [1397, 900]]} />
      <text x={1394} y={890} fontSize={17} fontWeight={700} fontFamily="Arial" textAnchor="end" fill="var(--path-chosen)" stroke="white" strokeWidth={5} paintOrder="stroke">PC+4</text>
      <Label x={1428} y={425} look="added" kind="ctrl" size={18}>MemtoReg (2 bits)</Label>
    </g>
  ),
  steps: [
    <><b>Jump part:</b> nothing new. The jump address and Jump = 1 work exactly like <code>j</code> (see the PC page).</>,
    <><b>Link part needs a new write register:</b> 31 ($ra) is not in any field of the instruction. Widen the RegDst mux to 3 inputs: 0 = rt, 1 = rd, <b>2 = the constant 31</b>. RegDst becomes 2 bits.</>,
    <><b>…and new write data:</b> PC + 4 is not the ALU result or memory data. Widen the MemtoReg mux to 3 inputs: 1 = memory, 0 = ALU, <b>2 = PC + 4</b> (a wire from the PC + 4 adder, drawn here as a labelled stub). MemtoReg becomes 2 bits.</>,
    <><b>RegWrite = 1</b>, so $ra ← PC + 4 happens at the same clock edge as PC ← jump address.</>,
  ],
  controls: [['Jump', '1'], ['RegDst', '10 (=2)', true], ['MemtoReg', '10 (=2)', true], ['RegWrite', '1'], ['MemWrite', '0'], ['MemRead', '0'], ['Branch', 'X'], ['ALUSrc', 'X'], ['ALUOp', 'XX']],
  notes: [
    <><b>Only 2×1 muxes allowed?</b> Use two extra 2×1 muxes instead: one after the RegDst mux (0 = old choice, 1 = 31) and one after the MemtoReg mux (0 = old choice, 1 = PC + 4), both selected by a new 1-bit signal <code>Jal</code>.</>,
    <>With 2-bit RegDst/MemtoReg, every old instruction keeps its old value with a leading 0 (e.g. lw: RegDst = 00, MemtoReg = 01).</>,
  ],
  pyq: [
    <><b>2018-19 Q1(a)</b> bne, j, jr, jal, slt, lui.</>,
    <><b>2012-13 Q2</b> bne, j, jr, jal, with control values for the new lines.</>,
  ],
}

// ---------------- lui ----------------
export const LUI: ExtensionSpec = {
  asm: 'lui rt, imm',
  title: 'Adding lui (load upper immediate)',
  crumb: 'Extending the single-cycle datapath · asked 2018-19 Q1(a)',
  lede: (
    <>
      <code>lui rt, imm</code> is <b>I-type</b> (op = 15). It does <code>rt ← imm × 2¹⁶</code>: the 16-bit constant goes into the <b>upper</b> half
      and the lower 16 bits become 0. Example: <code>lui $t0, 0x1234</code> gives $t0 = 0x12340000.
    </>
  ),
  active: [...FETCH, ...NEXT_SEQ, ...WRITE_RT, 'regs', 'imm', 'wb', 'ctrl_MemtoReg'],
  hidden: ['memtoreg'],
  overlay: (
    <g>
      <Wire look="chosen" pts={[[500, 990], [500, 1090], [1190, 1090]]} dots={[[500, 990]]} />
      <Slash x={560} y={1090} n="16" look="added" />
      <Oval cx={1250} cy={1090} rx={60} ry={38} lines={['Shift', 'left 16']} look="added" size={21} />
      <Wire look="chosen" pts={[[1310, 1090], [1385, 1090], [1385, 900], [1397, 900]]} />
      <Slash x={1345} y={1090} n="32" look="added" />
      <MemtoReg3 input2="" />
      <Label x={1428} y={425} look="added" kind="ctrl" size={18}>MemtoReg (2 bits)</Label>
    </g>
  ),
  steps: [
    <><b>Add a "Shift left 16" unit</b> fed by Instruction [15–0]. It outputs imm followed by 16 zeros (32 bits). It is only wires, like shift left 2.</>,
    <><b>Widen the MemtoReg mux to 3 inputs:</b> 1 = memory, 0 = ALU, <b>2 = imm « 16</b>. MemtoReg becomes 2 bits.</>,
    <><b>Destination is rt</b> (I-type), so RegDst = 0, and RegWrite = 1.</>,
    <>The ALU and data memory are not needed, so ALUSrc, ALUOp and MemtoReg's old inputs don't matter.</>,
  ],
  controls: [['MemtoReg', '10 (=2)', true], ['RegDst', '0'], ['RegWrite', '1'], ['MemRead', '0'], ['MemWrite', '0'], ['Branch', '0'], ['Jump', '0'], ['ALUSrc', 'X'], ['ALUOp', 'XX']],
  notes: [
    <><b>Alternative:</b> let the ALU do it. ALUSrc = 1 sends the immediate to the ALU; add a new ALU operation "shift B left 16" (new ALUOp code). Then MemtoReg = 0 and no new mux input is needed.</>,
    <>lui uses no Source registers. rs is 0 in the encoding.</>,
  ],
  pyq: [<><b>2018-19 Q1(a)</b> bne, j, jr, jal, slt, lui (30 marks).</>],
}

// ---------------- ori ----------------
export const ORI: ExtensionSpec = {
  asm: 'ori rt, rs, imm',
  title: 'Adding ori (OR immediate)',
  crumb: 'Extending the single-cycle datapath · asked 2020-21 Q3 (highlight active parts + control bits)',
  lede: (
    <>
      <code>ori rt, rs, imm</code> is <b>I-type</b> (op = 13). It does <code>rt ← Reg[rs] OR ZeroExt(imm)</code>. Logical immediates are
      <b> zero-extended</b> (upper 16 bits = 0), not sign-extended. Example: <code>ori $t1, $t2, 0x8000</code> ORs with 0x00008000, not 0xFFFF8000.
    </>
  ),
  active: [...FETCH, ...NEXT_SEQ, ...WRITE_RT, 'rs', 'regs', 'rd1', 'imm', 'sext', 'sextAlu', 'alusrc', 'aluB', 'alu', 'aluctlOut', 'ctrl_ALUOp', 'ctrl_ALUSrc', 'alures', 'aluresWb', 'memtoreg', 'wb'],
  hidden: ['signext', 'aluctl'],
  overlay: (
    <g>
      <Oval cx={730} cy={990} rx={56} ry={77} lines={['Sign/zero', 'extend']} look="added" size={21} />
      <Wire look="chosen" kind="ctrl" pts={[[838, 1050], [766, 1050]]} />
      <Label x={786} y={1038} look="added" kind="ctrl" size={18} bold>ExtOp</Label>
      <Oval cx={967} cy={1003} rx={50} ry={75} lines={['ALU', 'control']} look="added" />
      <Label x={1025} y={1100} look="added" size={18}>ALUOp 11 → OR</Label>
    </g>
  ),
  steps: [
    <><b>Same path as <code>addi</code>:</b> Source 1 (rs) → ALU, immediate → ALUSrc = 1 → ALU, result → MemtoReg = 0 → rt (RegDst = 0), RegWrite = 1.</>,
    <><b>Change 1: zero-extend.</b> Turn Sign-extend into a "Sign/zero-extend" unit with a new control signal <code>ExtOp</code>: 1 = sign-extend (lw, sw, beq, addi), 0 = zero-extend (ori).</>,
    <><b>Change 2: the ALU must OR.</b> ALUOp 00/01 means add/subtract, and 10 means "look at funct", but ori has no funct field. So use the unused code <b>ALUOp = 11 → OR</b> (ALU control outputs 0001).</>,
  ],
  controls: [['ALUOp', '11', true], ['ExtOp', '0', true], ['ALUSrc', '1'], ['RegDst', '0'], ['RegWrite', '1'], ['MemtoReg', '0'], ['MemRead', '0'], ['MemWrite', '0'], ['Branch', '0'], ['Jump', '0']],
  notes: [
    <><b>Alternative to ExtOp:</b> keep Sign-extend, add a separate Zero-extend unit and a 2×1 mux choosing between them.</>,
    <>In 2020-21 Q3 the operand is printed as <code>ori $t1, 100($t2)</code> (a typo in the paper). Treat it as <code>ori $t1, $t2, 100</code>.</>,
  ],
  pyq: [<><b>2020-21 Q3</b> Highlight the active datapath elements for ori and say which control bits are set (15 marks).</>],
}

// ---------------- slt ----------------
export const SLT: ExtensionSpec = {
  asm: 'slt rd, rs, rt',
  title: 'slt (set on less than): no change needed',
  crumb: 'Asked 2018-19 Q1(a) · already in the slide subset (Part 1 slides 2 and 24)',
  lede: (
    <>
      <code>slt rd, rs, rt</code> is <b>R-type</b> (op = 0, funct = 42 = 101010). It does <code>rd ← 1 if Reg[rs] &lt; Reg[rt], else 0</code>.
      The datapath already supports it: answer "no hardware change" and explain why.
    </>
  ),
  active: [...FETCH, ...NEXT_SEQ, ...ALU_RTYPE, 'rd', 'regdst', 'wreg', 'aluresWb', 'memtoreg', 'wb', 'ctrl_RegDst', 'ctrl_RegWrite'],
  steps: [
    <>It is an ordinary R-type instruction, so Control gives the R-type signals (ALUOp = 10).</>,
    <>ALU control sees funct = 101010 and outputs <b>0111 (set-on-less-than)</b>, already in the slide-24 table.</>,
    <>The ALU computes Source 1 − Source 2. If the result is negative, it outputs 1, otherwise 0. That 32-bit 0/1 goes through MemtoReg = 0 into rd.</>,
    <>Example: $t0 = 3, $t1 = 7, <code>slt $t2, $t0, $t1</code> → 3 &lt; 7 → $t2 = 1.</>,
  ],
  controls: [['RegDst', '1'], ['ALUSrc', '0'], ['ALUOp', '10'], ['MemtoReg', '0'], ['RegWrite', '1'], ['MemRead', '0'], ['MemWrite', '0'], ['Branch', '0'], ['Jump', '0']],
  notes: [<><b>slti</b> (immediate) <i>would</i> need a change: no funct field, so a new ALUOp code meaning "slt" plus ALUSrc = 1.</>],
  pyq: [<><b>2018-19 Q1(a)</b> lists slt with bne, j, jr, jal, lui. Saying "already supported, here's why" earns the marks.</>],
}
