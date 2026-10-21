import { hex, regName, wbValue, type Frame, type Instruction, type Packet } from './engine'

const C = { normal: '#657482', ex: '#d45b12', wb: '#7950c7', control: '#2463a4', stall: '#b52c36', idle: '#d8dee4', read: '#24825e' }
export function PipelineDatapath({ frame, program }: { frame: Frame; program: Instruction[] }) {
  const { state: s, signals: g } = frame
  const stages = [program[s.pc / 4], s.ifid?.ins, s.idex?.ins, s.exmem?.ins, s.memwb?.ins]
  const boundaries = [0, 270, 580, 990, 1270, 1500]
  const wire = (d: string, color = C.normal, active = true, title = '', dashed = false) => <path d={d} fill="none" stroke={active ? color : C.idle} strokeWidth={active ? 2.6 : 1.4} strokeDasharray={dashed ? '5 4' : undefined} markerEnd={`url(#pipe-${active ? Object.keys(C).find(k => C[k as keyof typeof C] === color) ?? 'normal' : 'idle'})`}><title>{title}</title></path>
  const block = (x: number, y: number, w: number, h: number, title: string, lines: string[], color = C.normal, active = true) => <g>
    <rect x={x} y={y} width={w} height={h} rx={9} fill={active ? '#fff' : '#f5f7f9'} stroke={active ? color : C.idle} strokeWidth={2} />
    <text x={x + w / 2} y={y + 23} textAnchor="middle" fontSize={14} fontWeight={700} fill={color}>{title}</text>
    {lines.map((line, i) => <text key={i} x={x + w / 2} y={y + 45 + i * 19} textAnchor="middle" fontSize={12} fill="#344454" textLength={line.length * 6.3 > w - 12 ? w - 12 : undefined} lengthAdjust="spacingAndGlyphs">{line}</text>)}
  </g>
  const latch = (x: number, label: string, p: Packet | null, hold = false) => <g>
    <rect x={x} y={175} width={36} height={290} rx={5} fill={hold ? '#fff0f0' : p?.bubble ? '#f0f1f3' : '#eaf1f9'} stroke={hold ? C.stall : C.control} strokeWidth={hold ? 3 : 1.5} />
    <text x={x + 18} y={162} textAnchor="middle" fontSize={14} fontWeight={700}>{label}</text>
    <text transform={`translate(${x + 23},320) rotate(-90)`} textAnchor="middle" fontSize={13} fill={hold ? C.stall : C.control}>{hold ? 'HOLD • write disabled' : p?.bubble ? `Bubble B${p.bubble} • controls = 0` : p?.ins ? `I${p.ins.id + 1} • latched at clock edge` : 'Empty'}</text>
    <text x={x + 18} y={486} textAnchor="middle" fontSize={11}>{p?.ins ? `PC+4: ${p.pc4}` : '—'}</text>
  </g>
  const muxColor = (sel: string) => sel === '10' ? C.ex : sel === '01' ? C.wb : C.normal
  return <svg className="pipeline-svg" viewBox="0 0 1500 730" role="img" aria-labelledby="pipeline-title pipeline-desc">
    <title id="pipeline-title">Five-stage MIPS datapath, cycle {s.cycle}, {s.half === 0 ? 'first' : 'second'} half</title>
    <desc id="pipeline-desc">Orange paths forward from EX/MEM, purple paths from MEM/WB. Red control paths hold PC and IF/ID and insert a bubble when a load-use hazard is detected. Detailed values follow below the diagram.</desc>
    <defs>{Object.entries(C).map(([key, value]) => <marker key={key} id={`pipe-${key}`} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6Z" fill={value} /></marker>)}</defs>
    {[0, 1, 2, 3, 4].map(i => <g key={i}>
      <rect x={boundaries[i] + 5} y={6} width={boundaries[i + 1] - boundaries[i] - 10} height={65} rx={8} fill={['#eaf1fa', '#eaf5ee', '#fff1e6', '#f1edfa', '#edf0f4'][i]} />
      <text x={boundaries[i] + 18} y={28} fontSize={14} fontWeight={700}>{['IF · Fetch', 'ID · Decode / read', 'EX · Execute', 'MEM · Memory', 'WB · Write back'][i]}</text>
      <text x={boundaries[i] + 18} y={52} fontSize={12}>{stages[i] ? `I${stages[i]!.id + 1}  ${stages[i]!.text}` : [null, s.ifid, s.idex, s.exmem, s.memwb][i]?.bubble ? `Bubble B${[null, s.ifid, s.idex, s.exmem, s.memwb][i]!.bubble} • no side effects` : 'Empty'}</text>
    </g>)}

    {/* Fetch and decode datapath. */}
    {wire('M75 300 H108', C.normal, !!stages[0])}
    {wire('M240 300 H270', C.normal, !!stages[0])}
    {wire('M50 265 V204 H110', C.normal, !!stages[0])}
    {wire('M212 205 H248 V100 H28 V265', C.normal, !!stages[0], 'PC + 4 is latched only when PCWrite = 1')}
    {wire('M306 285 H353', C.normal, !!s.ifid?.ins)}
    {wire('M306 310 H335 V345 H353', C.normal, !!s.ifid?.ins)}
    {wire('M306 255 H325 V203 H353', C.control, !!s.ifid?.ins)}
    {wire('M518 203 H580', g.stall ? C.stall : C.control, !!s.ifid?.ins, g.stall ? 'Control mux inserts all-zero controls' : 'Decoded controls enter ID/EX', true)}
    {wire('M518 300 H580', C.read, !!s.ifid?.ins && s.half === 1)}
    {wire('M518 342 H550 V370 H580', C.read, !!s.ifid?.ins && s.half === 1)}
    {wire('M306 414 H353', C.normal, !!s.ifid?.ins)}
    {wire('M518 433 H580', C.normal, !!s.ifid?.ins)}
    {/* Hazard detector inputs and freeze/control outputs. */}
    {wire('M325 255 V130 H355', C.control, !!s.ifid?.ins, 'IF/ID source register numbers', true)}
    {wire('M598 175 V122 H565', C.control, !!s.idex?.ins, 'ID/EX.MemRead and destination rt', true)}
    {wire('M355 107 H50 V265', C.stall, g.stall, 'PCWrite = 0', true)}
    {wire('M355 119 H288 V175', C.stall, g.stall, 'IF/IDWrite = 0', true)}
    {wire('M460 145 V175', C.stall, g.stall, 'Zero ID/EX controls', true)}
    {/* Execute paths: forwarded store data branches before ALUSrc. */}
    {wire('M616 265 H670', C.normal, !!s.idex?.ins && g.a.select === '00')}
    {wire('M616 370 H670', C.normal, !!s.idex?.ins && g.b.select === '00')}
    {wire('M755 264 H870', muxColor(g.a.select), !!s.idex?.ins)}
    {wire('M755 369 H790', muxColor(g.b.select), !!s.idex?.ins)}
    {wire('M770 369 V440 H990', muxColor(g.b.select), s.idex?.ins?.op === 'sw', 'ForwardB output is also the store data')}
    {wire('M616 432 H770 V402 H790', C.normal, !!s.idex?.control.ALUSrc)}
    {wire('M852 378 H870 V332', C.normal, !!s.idex?.ins)}
    {wire('M965 300 H990', C.normal, !!s.idex?.ins)}
    {wire('M616 185 H820 V130 H830', C.normal, !!s.idex?.control.RegWrite, 'rt / rd → destination mux')}
    {wire('M960 130 H1008 V175', C.normal, !!s.idex?.control.RegWrite, 'Destination number travels with the result')}
    {wire('M616 203 H650 V110 H680', C.control, !!s.idex?.ins, 'ID/EX.ALUOp and instruction function', true)}
    {wire('M745 147 V170 H917 V245', C.control, !!s.idex?.ins, 'Decoded ALU control', true)}
    {wire('M1026 185 H1288 V175', C.control, !!s.exmem?.control.RegWrite, 'WB control travels to MEM/WB', true)}
    {/* Memory and writeback. */}
    {wire('M1026 300 H1080', C.normal, !!s.exmem?.ins)}
    {wire('M1026 440 H1045 V390 H1080', C.normal, !!s.exmem?.control.MemWrite && !g.storeForward)}
    {wire('M1225 300 H1270', C.normal, !!s.exmem?.control.MemRead)}
    {wire('M1045 300 V220 H1250 V350 H1270', C.normal, !!s.exmem?.control.RegWrite && !s.exmem.control.MemRead)}
    {wire('M1306 300 H1350', C.normal, !!s.memwb?.control.MemtoReg)}
    {wire('M1306 350 H1330 V370 H1350', C.normal, !!s.memwb?.control.RegWrite && !s.memwb.control.MemtoReg)}
    {/* Shared feedback buses stay behind all components. */}
    {wire('M1045 300 V515 H640 V393', C.ex, g.a.select === '10' || g.b.select === '10')}
    {wire('M640 393 V288 H670', C.ex, g.a.select === '10', 'EX/MEM.ALUResult → ForwardA = 10')}
    {wire('M640 393 H670', C.ex, g.b.select === '10', 'EX/MEM.ALUResult → ForwardB = 10')}
    {wire('M1450 335 H1470 V550 H1058', C.wb, g.a.select === '01' || g.b.select === '01' || g.storeForward)}
    {wire('M1058 550 H655 V410', C.wb, g.a.select === '01' || g.b.select === '01')}
    {wire('M655 410 V305 H670', C.wb, g.a.select === '01', 'MEM/WB writeback value → ForwardA = 01')}
    {wire('M655 410 H670', C.wb, g.b.select === '01', 'MEM/WB writeback value → ForwardB = 01')}
    {wire('M1058 550 V408 H1080', C.wb, g.storeForward, 'Late store-data bypass: MEM/WB → data memory')}
    {wire('M1450 335 H1485 V690 H335 V370 H353', C.read, !!g.wb && s.half === 0, 'WB writes the register file at the end of the first half')}
    {/* Register numbers / write enables into forwarding unit. */}
    {wire('M598 465 V615 H790', C.control, !!s.idex?.ins, 'ID/EX.rs and rt', true)}
    {wire('M1008 465 V615 H990', C.control, !!s.exmem?.ins, 'EX/MEM destination and RegWrite', true)}
    {wire('M1288 465 V640 H990', C.control, !!s.memwb?.ins, 'MEM/WB destination and RegWrite', true)}
    {wire('M790 600 H710 V425', C.control, !!s.idex?.ins, 'ForwardB select', true)}
    {wire('M810 580 V470 H630 V230 H710', C.control, !!s.idex?.ins, 'ForwardA select', true)}

    {block(15, 265, 60, 84, 'PC', [String(s.pc), g.stall ? 'HOLD' : stages[0] ? '+4' : 'End'], g.stall ? C.stall : C.normal)}
    {block(110, 178, 102, 58, 'PC + 4', [String(s.pc + 4)])}
    {block(108, 265, 132, 96, 'Instruction', ['memory', stages[0] ? `I${stages[0].id + 1} @ ${hex(s.pc)}` : 'No fetch'], C.normal, !!stages[0])}
    {latch(270, 'IF/ID', s.ifid, g.stall)}
    {block(355, 83, 210, 62, 'Hazard detection unit', [g.stall ? 'PCWrite=0 · IF/IDWrite=0' : 'PCWrite=1 · IF/IDWrite=1'], g.stall ? C.stall : C.control)}
    {block(353, 175, 165, 62, 'Control → mux', [g.stall ? 'Select ZERO controls' : 'Select decoded controls'], g.stall ? C.stall : C.control)}
    {block(353, 265, 165, 118, 'Register file', [s.ifid?.ins ? `${regName(s.ifid.ins.rs)} = ${g.decodeA}` : 'rs = —', s.ifid?.ins ? `${regName(s.ifid.ins.rt)} = ${g.decodeB}` : 'rt = —', s.half ? '2nd half: read now' : '1st half: WB writes'], C.read)}
    {block(353, 407, 165, 58, 'Extend immediate', [String(s.ifid?.ins?.imm ?? 0)])}
    {latch(580, 'ID/EX', s.idex)}
    {block(680, 85, 130, 62, 'ALU control', [`ALUOp=${s.idex?.control.ALUOp ?? '00'}`], C.control, !!s.idex?.ins)}
    {block(830, 85, 130, 62, 'RegDst mux', [`${s.idex?.control.RegDst ?? 0} → ${s.idex?.ins && s.idex.control.RegWrite ? regName(s.idex.ins.dest) : 'no destination'}`], C.normal, !!s.idex?.control.RegWrite)}
    {block(670, 235, 85, 82, 'MUX A', [`${g.a.select} → ${g.a.value}`, g.a.source], muxColor(g.a.select), !!s.idex?.ins)}
    {block(670, 340, 85, 82, 'MUX B', [`${g.b.select} → ${g.b.value}`, g.b.pending ? 'wait for MEM' : g.b.source], muxColor(g.b.select), !!s.idex?.ins)}
    {block(790, 340, 62, 76, 'ALUSrc', [`sel: ${s.idex?.control.ALUSrc ?? 0}`, String(g.aluB)])}
    {block(870, 245, 95, 115, 'ALU', [s.idex?.control.ALUControl ?? '—', `${g.a.value}, ${g.aluB}`, `= ${g.result}`], C.normal, !!s.idex?.ins)}
    {latch(990, 'EX/MEM', s.exmem)}
    {block(1080, 265, 145, 164, 'Data memory', [s.exmem?.ins ? `addr: ${hex(s.exmem.result)}` : 'addr: —', `Read=${s.exmem?.control.MemRead ?? 0} Write=${s.exmem?.control.MemWrite ?? 0}`, g.memoryRead !== null ? `read: ${g.memoryRead}` : `store: ${g.store}`, g.storeForward ? 'MEM/WB bypass' : 'EX/MEM store data', 'writes at cycle edge'], g.storeForward ? C.wb : C.normal, !!(s.exmem?.control.MemRead || s.exmem?.control.MemWrite))}
    {latch(1270, 'MEM/WB', s.memwb)}
    {block(1350, 275, 100, 120, 'WB mux', [`MemtoReg=${s.memwb?.control.MemtoReg ?? 0}`, `value: ${s.memwb ? wbValue(s.memwb) : '—'}`, g.wb ? `→ ${regName(g.wb.dest)}` : 'no write', g.wb ? s.half ? 'write completed' : 'write pending' : 'write disabled'], C.read, !!g.wb)}
    {block(790, 580, 200, 79, 'Forwarding unit', [`ForwardA=${g.a.select} · ForwardB=${g.b.select}`, g.a.priority || g.b.priority ? 'EX/MEM wins both matches' : 'RegWrite && destination ≠ 0'], C.control)}
    <text x={675} y={505} fontSize={12} fill={C.ex}>10 · EX/MEM ALU result</text>
    <text x={675} y={540} fontSize={12} fill={C.wb}>01 · MEM/WB writeback value</text>
    <text x={1090} y={575} fontSize={12} fill={C.wb}>Extra path: store data needed in MEM</text>
    <text x={360} y={711} fontSize={12} fill={C.read}>WB → register file · first-half write, second-half read</text>
    <text x={20} y={635} fontSize={12} fill={g.stall ? C.stall : C.normal}>{g.stall ? 'STALL: hold PC + IF/ID; insert a bubble into ID/EX.' : 'All occupied pipeline registers advance at the next edge.'}</text>
    <text x={20} y={656} fontSize={12} fill={C.normal}>Solid = data · Dashed blue/red = control · Pale = inactive</text>
  </svg>
}
