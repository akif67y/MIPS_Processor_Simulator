// The pipelined datapath with forwarding and hazard detection, drawn like
// Chapter 4 Part 2 slides 52, 65 and 75 (Patterson & Hennessy Fig. 4.51/4.56/4.60)
// with the shapes of the single-cycle lessons.
//
// With branch hardware (control-hazard lab) the same drawing gains:
//  - 'mem' (slide 77, Fig. 4.51): shift left 2 + branch adder in EX, Zero, Branch AND Zero in MEM,
//    and IF.Flush / ID.Flush / EX.Flush when the branch is taken;
//  - 'id' (slide 78, Fig. 4.62): shift left 2 + branch adder and the "=" comparator in ID, with
//    EX/MEM forwarding into the comparator (slide 79) and IF.Flush.
// Both add a PC mux in IF and a band above the sheet that carries PCSrc and the target back to it.
// The base coordinates never change: x is warped (X) to open room for the added units.
//
// The base sheet is 2100 × 1280 and the text is sized like the single-cycle diagram
// (units 22–24, ports and signals 17–19), so at page width it reads the same.

import type { ReactNode } from 'react'
import { Adder, AndGate, Box, COLORS, Label, Mux, MuxN, Oval, Wire, hot, type Look } from '../datapath/shapes'
import { regName, hex, dontCare, isBranch, type Controls, type Cycle, type Hardware, type Instr, type Squash } from './engine'
import type { Phase } from './explain'
import { instrColor, tint } from './colors'

type Group = 'pc' | 'if' | 'id' | 'hdu' | 'ex' | 'fu' | 'mem' | 'wb' | 'rf' | 'regs' | 'br'
type Pt = [number, number]

/** What each sub-step of a cycle puts in the spotlight. */
const SPOT: Record<Phase, Group[]> = {
  edge: ['regs', 'pc'],
  wb: ['wb', 'rf'],
  id: ['pc', 'if', 'id', 'hdu', 'rf'],
  ex: ['ex', 'fu', 'mem'],
  br: ['br', 'pc'],
}

const W = 2100
const H = 1280
const MONO = 'Consolas, ui-monospace, monospace'
const FONT = 'Arial, Helvetica, sans-serif'

// Pipeline registers: x, width, top of the bar (the control boxes form a staircase as on slide 52).
const REG = {
  ifid: { x: 400, w: 40, top: 270, name: 'IF/ID' },
  idex: { x: 1000, w: 40, top: 270, name: 'ID/EX' },
  exmem: { x: 1540, w: 40, top: 310, name: 'EX/MEM' },
  memwb: { x: 1900, w: 40, top: 350, name: 'MEM/WB' },
}
const BOTTOM = 1025
// A pipeline register is lit whenever a stage that reads or writes it is in the spotlight.
const BAR_GROUPS: Record<keyof typeof REG, Group[]> = {
  ifid: ['regs', 'if', 'id', 'hdu', 'br'],
  idex: ['regs', 'id', 'hdu', 'ex', 'br'],
  exmem: ['regs', 'ex', 'mem', 'fu', 'br'],
  memwb: ['regs', 'mem', 'wb', 'fu'],
}

// Ellipses that wires start or end on.
const HDU = { cx: 770, cy: 140, rx: 140, ry: 48 }
const FU = { cx: 1290, cy: 1115, rx: 140, ry: 50 }
const CMP = { cx: 1165, cy: 630, rx: 30, ry: 56 } // branch comparator (ID mode, already warped)
type Ell = typeof HDU
const xAt = (e: Ell, y: number, side: -1 | 1) => e.cx + side * e.rx * Math.sqrt(Math.max(0, 1 - ((y - e.cy) / e.ry) ** 2))
const yAt = (e: Ell, x: number, side: -1 | 1) => e.cy + side * e.ry * Math.sqrt(Math.max(0, 1 - ((x - e.cx) / e.rx) ** 2))

// Lanes of the band above the sheet (branch hardware only).
const TARGET_Y = -40
const PCSRC_Y = -12

const fwdLook = (sel: string): Look => (sel === '10' ? 'exmem' : sel === '01' ? 'memwb' : 'normal')
const rank = (l: Look) => (l === 'faded' ? 0 : hot(l) ? 2 : 1)

function ctrlBits(c: Controls, part: 'WB' | 'M' | 'EX', op?: Instr['op'], branchInM = false) {
  const x = dontCare(op)
  const b = (k: keyof Controls, v: string) => (x.includes(k) ? 'X' : v)
  if (part === 'WB') return b('RegWrite', String(c.RegWrite)) + b('MemtoReg', String(c.MemtoReg))
  if (part === 'M') return (branchInM ? String(c.Branch) : '') + String(c.MemRead) + String(c.MemWrite)
  return b('RegDst', String(c.RegDst)) + c.ALUOp.toString(2).padStart(2, '0') + String(c.ALUSrc)
}

/** Small value tag (monospace, white box) placed over the diagram. */
function Tag({ x, y, text, color = '#212529', anchor = 'middle' }: { x: number; y: number; text: string; color?: string; anchor?: 'start' | 'middle' | 'end' }) {
  const w = text.length * 11.1 + 16
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w
  return (
    <g fontFamily={MONO} pointerEvents="none">
      <rect x={left} y={y - 21} width={w} height={29} rx={7} fill="white" stroke={color} strokeWidth={2} />
      <text x={left + 8} y={y} fontSize={20} fontWeight={700} fill={color}>{text}</text>
    </g>
  )
}

/** Label with a white halo so it stays readable where it crosses wires. */
function Halo({ x, y, children, color = COLORS.ctrl, size = 18, anchor = 'start', rotate = false, bold = false }: { x: number; y: number; children: ReactNode; color?: string; size?: number; anchor?: 'start' | 'middle' | 'end'; rotate?: boolean; bold?: boolean }) {
  return (
    <text x={x} y={y} fontFamily={FONT} fontSize={size} fontWeight={bold ? 700 : 400} fill={color} textAnchor={anchor}
      stroke="white" strokeWidth={5} paintOrder="stroke" transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}>
      {children}
    </text>
  )
}

/** Text for a packet that was thrown away by a branch. */
const goneText = (s: Squash) => `${s.why === 'flush' ? 'flushed' : 'discarded'}: ${s.instr.text}`

export function PipelineDatapath({ cycle: c, phase, spotlight, values, hw = {} }: { cycle: Cycle; phase: Phase; spotlight: boolean; values: boolean; hw?: Hardware }) {
  const BR = hw.branch
  // Room for the added units: ID mode widens ID (from x 1000), MEM mode widens EX (from 1050) and MEM (from 1600).
  const DX = BR === 'id' ? 480 : BR === 'mem' ? 240 : 0
  const BREAK = BR === 'id' ? 1000 : 1050
  const DX2 = BR === 'mem' ? 130 : 0
  const X = (x: number) => x + (x >= BREAK ? DX : 0) + (x >= 1600 ? DX2 : 0)
  const sh = (x: number) => `translate(${X(x) - x},0)` // shifts a group drawn in base coordinates
  const LEFT = BR ? 210 : 0
  const TOP = BR ? 150 : 0

  const { ifid, idex, exmem, memwb } = c.at
  const F = c.fetch.instr
  const D = ifid && !ifid.squashed ? ifid.instr : null
  const E = idex && !idex.bubble && !idex.squashed ? idex : null
  const M = exmem && !exmem.bubble && !exmem.squashed ? exmem : null
  const Wb = memwb && !memwb.bubble && !memwb.squashed ? memwb : null
  const stall = c.hazard.stall && !c.hazard.overridden
  const asked = c.hazard.stall // the hazard detection unit asked for a stall (it may be overridden by a flush)
  const ex = E ? c.ex : null
  const fa = ex?.fa.sel ?? '00'
  const fb = ex?.fb.sel ?? '00'
  const any10 = fa === '10' || fb === '10'
  const any01 = fa === '01' || fb === '01'
  const bUsed = !!E && (!E.ctrl.ALUSrc || !!E.ctrl.MemWrite)
  const memOp = !!M && (!!M.ctrl.MemRead || !!M.ctrl.MemWrite)
  const writes = !!c.wb?.writes
  const on = (cond: unknown, look: Look = 'normal'): Look => (cond ? look : 'faded')
  const rfLook = (cond: unknown): Look => (cond ? (phase === 'wb' ? 'rf' : 'normal') : 'faded')
  const lit = (gs: Group[]) => !spotlight || gs.some((g) => SPOT[phase].includes(g))
  const op = (gs: Group[]) => (lit(gs) ? 1 : 0.18)
  const showFwd = !spotlight || phase === 'ex'
  const show = (gs: Group[]) => values && lit(gs)

  // Branch state for this cycle.
  const b = c.branch
  const showBr = !spotlight || phase === 'br'
  const taken = !!b?.taken
  const flushing = c.squash?.why === 'flush'
  const ifFlush = !!c.squash?.ifid // a taken-branch flush, or a fetch discarded while waiting (stall on branch)
  const idBranch = BR === 'id' && D && isBranch(D.op) ? D : null
  const idBranchWait = !!idBranch && stall
  const exBranch = BR === 'mem' && E && isBranch(E.instr.op) ? E : null

  type WireDef = { pts: Pt[]; look: Look; g: Group[]; kind?: 'data' | 'ctrl'; thick?: boolean; arrow?: boolean; dots?: Pt[]; raw?: boolean }
  const wires: WireDef[] = []
  const w = (g: Group[], look: Look, pts: Pt[], opts: Partial<WireDef> = {}) => wires.push({ g, look, pts, ...opts })
  // Wire already in final (warped) coordinates.
  const wr = (g: Group[], look: Look, pts: Pt[], opts: Partial<WireDef> = {}) => wires.push({ g, look, pts, raw: true, ...opts })
  const ctl = { kind: 'ctrl' as const, arrow: true }

  // ---------- IF ----------
  const pcLoop: Look = on(F && !c.pcSrc && c.next.pc === c.at.pc + 4)
  w(['if', 'pc'], on(F), [[120, 630], [170, 630]], { dots: [[145, 630]] })
  w(['if'], on(F), [[145, 630], [145, 375], [200, 375]])
  w(['if'], on(F), [[180, 485], [200, 485]])
  w(['if'], on(F), [[300, 430], [400, 430]], { dots: [[340, 430]] })
  if (BR) {
    wr(['if', 'pc'], pcLoop, [[340, 430], [340, 250], [-150, 250], [-150, 595], [-120, 595]])
    wr(['pc', 'br'], c.pcSrc ? 'branch' : on(F || c.at.ifid), [[-80, 630], [60, 630]])
  } else {
    w(['if', 'pc'], on(F && !stall), [[340, 430], [340, 250], [30, 250], [30, 630], [60, 630]])
  }
  w(['if'], on(F), [[370, 640], [400, 640]])

  // ---------- ID ----------
  w(['id'], on(D), [[440, 640], [470, 640]], { arrow: false, dots: [[470, 640]] })
  w(['id'], on(D), [[470, 1000], [470, 320], [610, 320]])
  w(['id'], on(D), [[470, 520], [590, 520]], { dots: [[470, 520]] })
  w(['id'], on(D), [[470, 590], [590, 590]], { dots: [[470, 590]] })
  w(['id'], on(D), [[470, 900], [665, 900]], { dots: [[470, 900]] })
  w(['id'], on(D), [[775, 900], [1000, 900]])
  w(['id'], on(D), [[470, 940], [1000, 940]], { dots: [[470, 940]] })
  w(['id'], on(D), [[470, 965], [1000, 965]], { dots: [[470, 965]] })
  w(['id'], on(D), [[470, 1000], [1000, 1000]])
  w(['id'], on(D, c.id?.sameCycleRs ? 'rf' : 'normal'), [[880, 540], [1000, 540]])
  w(['id'], on(D, c.id?.sameCycleRt ? 'rf' : 'normal'), [[880, 715], [1000, 715]])
  if (BR !== 'id') w(['id'], on(D), [[440, 430], [1000, 430]])
  w(['id'], on(D && !stall), [[710, 300], [910, 300]], ctl)
  w(['id', 'hdu'], asked ? 'hazard' : 'faded', [[885, 365], [910, 365]], ctl)
  const ctrlOut: Look = D ? (stall ? 'hazard' : 'normal') : 'faded'
  w(['id'], ctrlOut, [[950, 330], [1000, 330]], { ...ctl, dots: [[975, 330]] })
  w(['id'], ctrlOut, [[975, 330], [975, 290], [1000, 290]], ctl)
  w(['id'], ctrlOut, [[975, 330], [975, 370], [1000, 370]], ctl)

  // ---------- hazard detection unit (slide 75) ----------
  const hz = c.hazard
  const hzIn = (match: boolean): Look => (!hz.checked ? 'faded' : asked && match ? 'hazard' : 'normal')
  const hzOut: Look = asked ? 'hazard' : 'normal'
  const ifidWriteX = BR ? 412 : 420
  w(['hdu'], hzIn(hz.matchRs || !!hz.branch?.aluRs || !!hz.branch?.loadRs), [[500, 520], [500, 155], [xAt(HDU, 155, -1), 155]], { dots: [[500, 520]] })
  w(['hdu'], hzIn(hz.matchRt || !!hz.branch?.aluRt || !!hz.branch?.loadRt), [[525, 590], [525, 175], [xAt(HDU, 175, -1), 175]], { dots: [[525, 590]] })
  w(['hdu'], idex ? hzOut : 'faded', [[1060, 330], [1060, 115], [xAt(HDU, 115, 1), 115]], { ...ctl, dots: [[1060, 330]] })
  w(['hdu'], idex ? hzOut : 'faded', [[1085, 965], [1085, 140], [xAt(HDU, 140, 1), 140]], { dots: [[1085, 965]] })
  w(['hdu', 'pc'], stall ? 'hazard' : 'normal', [[xAt(HDU, 110, -1), 110], [90, 110], [90, 560]], ctl)
  w(['hdu'], stall ? 'hazard' : 'normal', [[xAt(HDU, 130, -1), 130], [ifidWriteX, 130], [ifidWriteX, REG.ifid.top]], ctl)
  w(['hdu'], hzOut, [[xAt(HDU, 168, 1), 168], [930, 168], [930, 270]], ctl)
  if (BR === 'id') {
    // Slides 80–81: the unit also needs EX/MEM.MemRead and EX/MEM.RegisterRd (a load in MEM).
    const lk: Look = !hz.branch ? 'faded' : hz.branch.loadRs || hz.branch.loadRt ? 'hazard' : 'normal'
    wr(['hdu'], lk, [[X(1595), 980], [X(1595), 70], [830, 70], [830, yAt(HDU, 830, -1)]], { dots: [[X(1595), 980]] })
  }

  // ---------- EX ----------
  w(['ex'], on(E), [[1040, 290], [1520, 290], [1520, 330], [1540, 330]], ctl)
  w(['ex'], on(E), [[1040, 330], [1500, 330], [1500, 370], [1540, 370]], ctl)
  w(['ex'], on(E), [[1040, 360], [1288, 360], [1288, 715]], ctl)
  w(['ex'], on(E), [[1040, 372], [1460, 372], [1460, 900], [1435, 900]], { ...ctl, thick: true })
  w(['ex'], on(E && E.ctrl.RegWrite), [[1040, 384], [1498, 384], [1498, 925]], ctl)
  w(['ex'], on(E && fa === '00'), [[1040, 540], [1140, 540]])
  w(['ex'], on(E && fb === '00' && bUsed), [[1040, 715], [1140, 715]])
  w(['ex'], E ? fwdLook(fa) : 'faded', [[1190, 575], [1330, 575]])
  w(['ex'], E && bUsed ? fwdLook(fb) : 'faded', [[1190, 750], [1225, 750]], { arrow: false, dots: [[1225, 750]] })
  w(['ex'], E && !E.ctrl.ALUSrc ? fwdLook(fb) : 'faded', [[1225, 750], [1270, 750]])
  w(['ex'], E?.ctrl.MemWrite ? fwdLook(fb) : 'faded', [[1225, 750], [1225, 845], [1540, 845]])
  w(['ex'], on(E), [[1040, 900], [1335, 900]], { dots: [[1250, 900]] })
  w(['ex'], on(E?.ctrl.ALUSrc), [[1250, 900], [1250, 800], [1270, 800]])
  w(['ex'], on(E), [[1306, 770], [1330, 770]])
  w(['ex'], on(E), [[1440, 650], [1540, 650]])
  w(['ex'], on(E), [[1385, 868], [1385, 778]], { ...ctl, thick: true })
  w(['ex', 'fu'], on(E), [[1040, 965], [1085, 965]], { arrow: false })
  w(['ex'], on(E && E.ctrl.RegWrite && !E.ctrl.RegDst), [[1085, 965], [1480, 965]])
  w(['ex'], on(E && E.ctrl.RegWrite && E.ctrl.RegDst), [[1040, 1000], [1480, 1000]])
  w(['ex'], on(E && E.ctrl.RegWrite), [[1516, 980], [1540, 980]])

  // ---------- forwarding unit (slides 61–65) ----------
  const fuIn = (sel: string, src: '10' | '01'): Look => (!E ? 'faded' : showFwd && sel === src ? fwdLook(src) : 'normal')
  const rsIn: Look = !E ? 'faded' : showFwd && fa !== '00' ? fwdLook(fa) : 'normal'
  const rtIn: Look = !E ? 'faded' : showFwd && fb !== '00' && !ex?.fb.unused ? fwdLook(fb) : 'normal'
  w(['fu'], rsIn, [[1040, 940], [1062, 940], [1062, 1100], [xAt(FU, 1100, -1), 1100]])
  w(['fu'], rtIn, [[1085, 965], [1085, 1130], [xAt(FU, 1130, -1), 1130]])
  const exSrc = E && exmem ? fuIn(any10 ? '10' : '', '10') : 'faded'
  const memSrc = E && memwb ? fuIn(any01 ? '01' : '', '01') : 'faded'
  w(['fu', 'mem'], exSrc, [[1615, 330], [1615, 1080], [xAt(FU, 1080, 1), 1080]], { ...ctl, dots: [[1615, 330]] })
  w(['fu', 'mem'], exSrc, [[1635, 980], [1635, 1105], [xAt(FU, 1105, 1), 1105]], { dots: [[1635, 980]] })
  w(['fu', 'wb'], memSrc, [[1955, 378], [1955, 1130], [xAt(FU, 1130, 1), 1130]], ctl)
  w(['fu', 'wb'], memSrc, [[1380, 1195], [1380, yAt(FU, 1380, 1)]], { dots: [[1380, 1195]] })
  w(['fu'], E ? (fa === '00' ? 'normal' : fwdLook(fa)) : 'faded', [[1203, yAt(FU, 1203, -1)], [1203, 662], [1165, 662], [1165, 645]], ctl)
  w(['fu'], E ? (fb === '00' ? 'normal' : fwdLook(fb)) : 'faded', [[1165, yAt(FU, 1165, -1)], [1165, 820]], ctl)
  // EX/MEM.ALUResult → the "10" inputs; MEM/WB value → the "01" inputs.
  // Forwarding paths are only coloured in the EX step (or with the spotlight off).
  const busA10 = showFwd && E && fa === '10', busB10 = showFwd && E && fb === '10' && bUsed
  const busA01 = showFwd && E && fa === '01', busB01 = showFwd && E && fb === '01' && bUsed
  // ID mode: the same EX/MEM.ALUResult also feeds the branch comparator muxes (slide 79).
  const cmpFwd = BR === 'id' && !!b && (b.fa?.sel === 1 || b.fb?.sel === 1)
  const busCmp = cmpFwd && showBr
  const cmpG: Group[] = BR === 'id' ? ['br'] : []
  w(['fu', 'mem', ...cmpG], busA10 || busB10 || busCmp ? 'exmem' : 'faded', [[1650, 900], [1650, 1222], [1118, 1222], [1118, 791]], { arrow: false, dots: [[1118, 791], ...(BR === 'id' ? [[1118, 1222] as Pt] : [])] })
  w(['fu'], busA10 ? 'exmem' : 'faded', [[1118, 791], [1118, 616], [1140, 616]])
  w(['fu'], busB10 ? 'exmem' : 'faded', [[1118, 791], [1140, 791]])
  w(['fu', 'wb'], busA01 || busB01 ? 'memwb' : 'faded', [[1100, 1250], [1100, 753]], { arrow: false, dots: [[1100, 1250], [1100, 753]] })
  w(['fu'], busA01 ? 'memwb' : 'faded', [[1100, 753], [1100, 578], [1140, 578]])
  w(['fu'], busB01 ? 'memwb' : 'faded', [[1100, 753], [1140, 753]])

  // ---------- MEM ----------
  // With the branch in MEM the M field carries Branch too, so its three wires are spread out.
  const [mwY, mrY] = BR === 'mem' ? [358, 371] : [362, 378]
  w(['mem'], on(M), [[1580, 330], [1880, 330], [1880, 370], [1900, 370]], ctl)
  w(['mem'], on(M), [[1580, mwY], [1740, mwY], [1740, 560]], ctl)
  w(['mem'], on(M), [[1580, mrY], [1810, mrY], [1810, 560]], ctl)
  const exmemOut: Look = showFwd && (busA10 || busB10) ? 'exmem' : busCmp ? 'exmem' : on(M)
  w(['mem', 'fu', ...cmpG], exmemOut, [[1580, 650], [1650, 650]], { arrow: false, dots: [[1650, 650]] })
  w(['mem'], on(memOp), [[1650, 650], [1690, 650]])
  w(['mem', 'fu', ...cmpG], (showFwd && (busA10 || busB10)) || busCmp ? 'exmem' : on(M && M.ctrl.RegWrite && !M.ctrl.MemRead), [[1650, 650], [1650, 900]], { arrow: false, dots: [[1650, 900]] })
  w(['mem'], on(M && M.ctrl.RegWrite && !M.ctrl.MemRead), [[1650, 900], [1900, 900]])
  w(['mem'], on(M?.ctrl.MemWrite), [[1580, 845], [1690, 845]])
  w(['mem'], on(M?.ctrl.MemRead), [[1860, 650], [1900, 650]])
  w(['mem'], on(M && M.ctrl.RegWrite), [[1580, 980], [1900, 980]])

  // ---------- WB (slide 55: write in the first half) ----------
  w(['wb'], on(Wb), [[1940, 378], [1955, 378]], { ...ctl, arrow: false, dots: [[1955, 378]] })
  w(['wb', 'rf'], rfLook(Wb?.ctrl.RegWrite), [[1955, 378], [1955, 238], [860, 238], [860, 480]], ctl)
  w(['wb'], on(Wb?.ctrl.RegWrite), [[1940, 362], [2010, 362], [2010, 622]], ctl)
  w(['wb'], on(Wb?.ctrl.MemtoReg), [[1940, 650], [1990, 650]])
  w(['wb'], on(Wb && Wb.ctrl.RegWrite && !Wb.ctrl.MemtoReg), [[1940, 900], [1990, 900]])
  const wbOut: Look = showFwd && (busA01 || busB01) && phase !== 'wb' ? 'memwb' : rfLook(Wb?.ctrl.RegWrite)
  w(['wb', 'fu'], wbOut, [[2030, 775], [2065, 775], [2065, 1250], [1100, 1250]], { arrow: false })
  w(['wb', 'rf'], rfLook(writes), [[1100, 1250], [560, 1250], [560, 740], [590, 740]])
  const rdOut: Look = showFwd && (busA01 || busB01) && phase !== 'wb' ? 'memwb' : rfLook(Wb?.ctrl.RegWrite)
  w(['wb', 'fu'], rdOut, [[1940, 980], [1975, 980], [1975, 1195], [1380, 1195]], { arrow: false })
  w(['wb', 'rf'], rfLook(writes), [[1380, 1195], [575, 1195], [575, 665], [590, 665]])

  // ---------- branch hardware ----------
  // PCSrc and the target travel back to the PC mux along the band above the sheet.
  const pcSrcLook: Look = b ? (taken ? 'branch' : 'normal') : 'faded'
  const targetLook: Look = taken ? 'branch' : b ? 'normal' : 'faded'
  if (BR === 'mem') {
    // EX: shift left 2 + Add on ID/EX.PC + 4 and the immediate; Zero from the ALU (Fig. 4.51).
    const exb: Look = exBranch ? 'normal' : 'faded'
    wr(['ex', 'br'], exb, [[1040, 430], [1120, 430]])
    wr(['ex', 'br'], exb, [[1080, 900], [1080, 848]], { dots: [[1080, 900]] })
    wr(['ex', 'br'], exb, [[1080, 792], [1080, 500], [1120, 500]])
    wr(['ex', 'br'], exb, [[1200, 460], [X(1540), 460]])
    wr(['ex', 'br'], exb, [[X(1440), 610], [X(1540), 610]])
    // MEM: PCSrc = Branch AND Zero.
    const mb: Look = M?.ctrl.Branch ? (taken ? 'branch' : 'normal') : 'faded'
    wr(['mem', 'br'], mb, [[X(1580), 384], [1872, 384], [1872, 412], [1888, 412]], ctl)
    wr(['mem', 'br'], mb, [[X(1580), 610], [1858, 610], [1858, 438], [1888, 438]])
    wr(['mem', 'br'], pcSrcLook, [[1934, 425], [1950, 425], [1950, PCSRC_Y], [-100, PCSRC_Y], [-100, 560]], { ...ctl, dots: [[430, PCSRC_Y], [1020, PCSRC_Y], [X(1560), PCSRC_Y]] })
    wr(['mem', 'br'], targetLook, [[X(1580), 460], [1838, 460], [1838, TARGET_Y], [-180, TARGET_Y], [-180, 665], [-120, 665]])
    // Flush the three younger instructions (slide 77).
    wr(['br'], ifFlush ? 'flush' : 'faded', [[430, PCSRC_Y], [430, REG.ifid.top]], ctl)
    wr(['br'], flushing && c.at.ifid ? 'flush' : 'faded', [[1020, PCSRC_Y], [1020, REG.idex.top]], ctl)
    wr(['br'], flushing && c.at.idex ? 'flush' : 'faded', [[X(1560), PCSRC_Y], [X(1560), REG.exmem.top]], ctl)
  }
  if (BR === 'id') {
    const cmpOn = !!idBranch
    const cl = (sel: 0 | 1 | undefined): Look => (!cmpOn || idBranchWait ? 'faded' : showBr && sel === 1 ? 'exmem' : 'normal')
    // Comparator inputs: register value (0) or EX/MEM.ALUResult (1).
    wr(['br', 'fu'], busCmp ? 'exmem' : 'faded', [[X(1118), 1222], [1010, 1222], [1010, 470], [1045, 470]], { dots: [[1010, 790]] })
    wr(['br', 'fu'], showBr && b?.fb?.sel === 1 ? 'exmem' : 'faded', [[1010, 790], [1045, 790]])
    wr(['br'], cmpOn && b?.fa?.sel !== 1 ? 'normal' : 'faded', [[1025, 540], [1025, 510], [1045, 510]], { dots: [[1025, 540]] })
    wr(['br'], cmpOn && b?.fb?.sel !== 1 ? 'normal' : 'faded', [[1025, 715], [1025, 750], [1045, 750]], { dots: [[1025, 715]] })
    wr(['br'], cl(b?.fa?.sel), [[1089, 490], [1102, 490], [1102, 605], [xAt(CMP, 605, -1), 605]])
    wr(['br'], cl(b?.fb?.sel), [[1089, 770], [1102, 770], [1102, 655], [xAt(CMP, 655, -1), 655]])
    wr(['br'], b ? (b.equal ? 'branch' : 'normal') : 'faded', [[1195, 640], [1240, 640]])
    wr(['br', 'id'], cmpOn ? (taken ? 'branch' : 'normal') : 'faded', [[660, 380], [660, 400], [1225, 400], [1225, 614], [1240, 614]], ctl)
    // Target adder in ID: IF/ID.PC + 4 + (immediate << 2).
    wr(['br', 'id'], cmpOn ? 'normal' : 'faded', [[440, 430], [1340, 430], [1340, 760], [1360, 760]])
    wr(['br', 'id'], cmpOn ? 'normal' : 'faded', [[1280, 900], [1280, 876]], { dots: [[1280, 900]] })
    wr(['br', 'id'], cmpOn ? 'normal' : 'faded', [[1336, 850], [1360, 850]])
    wr(['br'], pcSrcLook, [[1288, 627], [1310, 627], [1310, PCSRC_Y], [-100, PCSRC_Y], [-100, 560]], { ...ctl, dots: [[430, PCSRC_Y]] })
    wr(['br'], targetLook, [[1425, 805], [1450, 805], [1450, TARGET_Y], [-180, TARGET_Y], [-180, 665], [-120, 665]])
    wr(['br'], ifFlush ? 'flush' : 'faded', [[430, PCSRC_Y], [430, REG.ifid.top]], ctl)
  }

  wires.sort((a, b) => rank(a.look) - rank(b.look))

  // ---------- pipeline registers ----------
  const bar = (key: keyof typeof REG, p: { instr: Instr; bubble?: boolean; squashed?: Squash } | null, ctrl: Controls | null, parts: ('WB' | 'M' | 'EX')[], hold = false) => {
    const r = REG[key]
    const x = X(r.x)
    const gone = p?.squashed
    const color = p ? (gone ? COLORS.flush : p.bubble ? '#868e96' : instrColor(p.instr)) : '#adb5bd'
    const dataTop = r.top + parts.length * 40
    const label = p ? (gone ? goneText(gone) : p.bubble ? 'bubble · controls = 0' : p.instr.text) : 'empty'
    const mid = (dataTop + BOTTOM) / 2
    return (
      <g key={key} opacity={op(BAR_GROUPS[key])}>
        <rect x={x} y={dataTop} width={r.w} height={BOTTOM - dataTop} fill={p ? (gone ? 'url(#pl-flush)' : p.bubble ? 'url(#pl-hatch)' : tint(color, '22')) : '#f8f9fa'}
          stroke={hold ? COLORS.hazard : '#343a40'} strokeWidth={hold ? 5 : 2.4} />
        {parts.map((part, i) => (
          <g key={part}>
            <rect x={x} y={r.top + i * 40} width={r.w} height={40} fill={p ? 'white' : '#f8f9fa'} stroke={COLORS.ctrl} strokeWidth={2.2} />
            <text x={x + r.w / 2} y={r.top + i * 40 + 16} fontFamily={FONT} fontSize={14} fill={COLORS.ctrl} textAnchor="middle">{part}</text>
            {ctrl && values && <text x={x + r.w / 2} y={r.top + i * 40 + 34} fontFamily={MONO} fontSize={part === 'M' && BR === 'mem' ? 13 : 15} fontWeight={700} fill={p?.bubble ? (gone ? COLORS.flush : COLORS.hazard) : COLORS.ctrl} textAnchor="middle">{ctrlBits(ctrl, part, p?.bubble ? undefined : p?.instr.op, BR === 'mem')}</text>}
          </g>
        ))}
        <text x={x + r.w / 2 + 7} y={mid} transform={`rotate(-90 ${x + r.w / 2 + 7} ${mid})`} textAnchor="middle"
          fontFamily={MONO} fontSize={22} fontWeight={700} fill={p ? color : '#adb5bd'}
          textLength={label.length * 12.2 > BOTTOM - dataTop - 20 ? BOTTOM - dataTop - 20 : undefined} lengthAdjust="spacingAndGlyphs">{label}</text>
        <text x={x + r.w / 2} y={r.top - 12} fontFamily={FONT} fontSize={22} fontWeight={700} textAnchor="middle" fill="#212529">{r.name}</text>
        {p && !p.bubble && !gone && <g>
          <circle cx={x + r.w / 2} cy={BOTTOM + 21} r={16} fill={color} />
          <text x={x + r.w / 2} y={BOTTOM + 27} textAnchor="middle" fontFamily={FONT} fontSize={16} fontWeight={700} fill="white">I{p.instr.id + 1}</text>
        </g>}
        {gone && <text x={x + r.w / 2} y={BOTTOM + 30} textAnchor="middle" fontFamily={FONT} fontSize={26} fontWeight={700} fill={COLORS.flush}>✕</text>}
        {hold && <Tag x={x + r.w / 2} y={BOTTOM + 76} text="HOLD" color={COLORS.hazard} />}
      </g>
    )
  }

  // ---------- stage banners ----------
  const sq = c.squash
  const stages: { name: string; x0: number; x1: number; who: Instr | null; bubble?: boolean; gone?: Squash; note?: string; tone?: 'hazard' | 'flush' | 'branch' }[] = [
    {
      name: 'IF', x0: 8 - LEFT, x1: 394, who: F,
      ...(F && sq?.ifid ? { note: sq.why === 'flush' ? 'wrong path: flushed at the edge' : 'thrown away: branch undecided', tone: 'flush' as const }
        : { note: F ? (stall ? 'fetched again next cycle' : `address ${c.fetch.pc}`) : 'nothing left to fetch', tone: stall ? 'hazard' as const : undefined }),
    },
    {
      name: 'ID', x0: 446, x1: BR === 'id' ? 994 + DX : 994, who: ifid?.instr ?? null, gone: ifid?.squashed,
      ...(D && stall ? { note: idBranchWait ? 'branch waits: operands not ready' : 'stalled: decoded again next cycle', tone: 'hazard' as const }
        : b?.at === 'id' ? { note: b.taken ? `taken → PC ← ${b.target}` : 'not taken', tone: 'branch' as const }
          : sq?.idex ? { note: 'wrong path: ID.Flush', tone: 'flush' as const } : {}),
    },
    { name: 'EX', x0: X(1046), x1: X(1534), who: idex?.instr ?? null, bubble: idex?.bubble, gone: idex?.squashed, ...(sq?.exmem ? { note: 'wrong path: EX.Flush', tone: 'flush' as const } : {}) },
    {
      name: 'MEM', x0: X(1586), x1: X(1894), who: exmem?.instr ?? null, bubble: exmem?.bubble, gone: exmem?.squashed,
      ...(b?.at === 'mem' ? { note: b.taken ? `taken → ${b.target}` : 'not taken', tone: 'branch' as const } : {}),
    },
    { name: 'WB', x0: X(1946), x1: X(2092), who: memwb?.instr ?? null, bubble: memwb?.bubble, gone: memwb?.squashed },
  ]
  const toneColor = { hazard: COLORS.hazard, flush: COLORS.flush, branch: COLORS.branch }

  const vbW = W + DX + DX2 + LEFT
  return (
    <svg viewBox={`${-LEFT} ${-TOP} ${vbW} ${H + TOP}`} className="pipeline-svg" style={{ minWidth: Math.round((1050 * vbW) / W) }} role="img"
      aria-label={`Pipelined datapath with forwarding and hazard detection${BR ? `, branch decided in ${BR.toUpperCase()}` : ''}, clock cycle ${c.n}`}>
      <defs>
        <pattern id="pl-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="#f1f3f5" />
          <line x1="0" y1="0" x2="0" y2="10" stroke="#ced4da" strokeWidth="5" />
        </pattern>
        <pattern id="pl-flush" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width="10" height="10" fill="#fff0f6" />
          <line x1="0" y1="0" x2="0" y2="10" stroke="#fcc2d7" strokeWidth="5" />
        </pattern>
      </defs>
      <rect x={-LEFT} y={-TOP} width={vbW} height={H + TOP} fill="white" />

      {stages.map((s) => {
        const y0 = 8 - TOP
        const color = s.gone ? COLORS.flush : s.who && !s.bubble ? instrColor(s.who) : '#868e96'
        const text = s.who ? (s.gone ? goneText(s.gone) : s.bubble ? 'bubble (nop)' : s.who.text) : '(empty)'
        const room = s.x1 - s.x0 - 32
        return (
          <g key={s.name}>
            <rect x={s.x0} y={y0} width={s.x1 - s.x0} height={76} rx={10} fill={s.who ? (s.gone ? 'url(#pl-flush)' : s.bubble ? 'url(#pl-hatch)' : tint(color)) : '#f8f9fa'} stroke={s.who ? color : '#dee2e6'} strokeWidth={2} />
            <rect x={s.x0} y={y0} width={10} height={76} rx={5} fill={s.who ? color : '#dee2e6'} />
            <text x={s.x0 + 22} y={y0 + 29} fontFamily={FONT} fontSize={22} fontWeight={700} fill={s.who ? color : '#adb5bd'}>
              {s.name}{s.who && !s.bubble && !s.gone ? `  ·  I${s.who.id + 1}` : ''}
            </text>
            <text x={s.x0 + 22} y={y0 + 61} fontFamily={MONO} fontSize={22} fontWeight={700} fill={s.who ? (s.bubble || s.gone ? '#495057' : '#212529') : '#adb5bd'}
              textLength={text.length * 12.2 > room ? room : undefined} lengthAdjust="spacingAndGlyphs">{text}</text>
            {s.note && <text x={s.x1 - 12} y={y0 + 29} fontFamily={FONT} fontSize={17} textAnchor="end" fill={s.tone ? toneColor[s.tone] : '#495057'} fontWeight={s.tone ? 700 : 400}>{s.note}</text>}
            {s.bubble && !s.gone && !s.note && s.x1 - s.x0 > 400 && <text x={s.x1 - 12} y={y0 + 29} fontFamily={FONT} fontSize={17} textAnchor="end" fill="#495057">all controls 0 · writes nothing</text>}
          </g>
        )
      })}

      {wires.map((x, i) => (
        <g key={i} opacity={op(x.g)}>
          <Wire pts={x.raw ? x.pts : x.pts.map(([px, py]) => [X(px), py] as Pt)} look={x.look} kind={x.kind} thick={x.thick} arrow={x.arrow ?? true}
            dots={x.raw ? x.dots : x.dots?.map(([px, py]) => [X(px), py] as Pt)} />
        </g>
      ))}

      {/* ---------- IF units ---------- */}
      <g opacity={op(['pc'])}>
        <Box x={60} y={560} w={60} h={140} look={stall ? 'hazard' : 'normal'}>
          <Label x={90} y={638} look={stall ? 'hazard' : 'normal'} bold anchor="middle" size={24}>PC</Label>
        </Box>
      </g>
      {BR && <g opacity={op(['pc', 'br'])}>
        <Mux x={-120} y={560} w={40} h={140} top="0" bottom="1" look={c.pcSrc ? 'branch' : 'normal'} />
      </g>}
      <g opacity={op(['if'])}>
        <Box x={170} y={520} w={200} h={240} look={on(F)}>
          <Label x={180} y={625} look={on(F)} size={19}>Read</Label>
          <Label x={180} y={648} look={on(F)} size={19}>address</Label>
          <Label x={362} y={646} look={on(F)} size={19} anchor="end">Instruction</Label>
          <Label x={270} y={714} look={on(F)} size={22} bold anchor="middle">Instruction</Label>
          <Label x={270} y={740} look={on(F)} size={22} bold anchor="middle">memory</Label>
        </Box>
        <Adder lx={200} lt={345} lb={515} rx={300} rt={390} rb={470} look={on(F)}>
          <Label x={260} y={438} look={on(F)} bold anchor="middle" size={22}>Add</Label>
        </Adder>
        <Label x={168} y={492} look={on(F)} anchor="middle" size={22}>4</Label>
      </g>

      {/* ---------- ID units ---------- */}
      <g opacity={op(['id'])}>
        <Oval cx={660} cy={320} rx={50} ry={60} lines={['Control']} look={on(D)} kind="ctrl" size={19} />
        <Mux x={910} y={270} w={40} h={120} top="0" bottom="1" look={on(D, stall ? 'hazard' : 'normal')} />
        <Label x={879} y={372} look={asked ? 'hazard' : 'faded'} kind="ctrl" anchor="end" size={22}>0</Label>
        <Oval cx={720} cy={900} rx={55} ry={40} lines={['Sign-', 'extend']} look={on(D)} size={17} />
      </g>
      <g opacity={op(['id', 'rf', 'wb'])}>
        <Box x={590} y={480} w={290} h={290} look={on(D || Wb, phase === 'wb' && writes ? 'rf' : 'normal')}>
          <Label x={600} y={526} look="normal" size={19}>Read register 1</Label>
          <Label x={600} y={596} look="normal" size={19}>Read register 2</Label>
          <Label x={600} y={671} look="normal" size={19}>Write register</Label>
          <Label x={600} y={746} look="normal" size={19}>Write data</Label>
          <Label x={870} y={546} look="normal" size={19} anchor="end">Read data 1</Label>
          <Label x={870} y={721} look="normal" size={19} anchor="end">Read data 2</Label>
          <Label x={800} y={638} look="normal" size={23} bold anchor="middle">Registers</Label>
        </Box>
      </g>
      <g opacity={op(['hdu'])}>
        <Oval cx={HDU.cx} cy={HDU.cy} rx={HDU.rx} ry={HDU.ry} lines={['Hazard', 'detection unit']} look={asked ? 'hazard' : 'normal'} kind="ctrl" size={21} />
      </g>

      {/* ---------- branch units ---------- */}
      {BR === 'mem' && <g opacity={op(['ex', 'br'])}>
        <Oval cx={1080} cy={820} rx={48} ry={28} lines={['Shift', 'left 2']} look={exBranch ? 'normal' : 'faded'} size={15} />
        <Adder lx={1120} lt={400} lb={520} rx={1200} rt={430} rb={490} look={exBranch ? 'normal' : 'faded'}>
          <Label x={1165} y={467} look={exBranch ? 'normal' : 'faded'} bold anchor="middle" size={20}>Add</Label>
        </Adder>
        <AndGate x={1888} y={398} w={46} h={54} look={M?.ctrl.Branch ? (taken ? 'branch' : 'normal') : 'faded'} />
      </g>}
      {BR === 'id' && <g opacity={op(['br', 'id'])}>
        <MuxN x={1045} y={446} w={44} h={88} inputs={[{ t: '1', y: 470 }, { t: '0', y: 510 }]} look={idBranch && !idBranchWait ? (b?.fa?.sel ? 'exmem' : 'normal') : 'faded'} />
        <MuxN x={1045} y={728} w={44} h={88} inputs={[{ t: '0', y: 750 }, { t: '1', y: 790 }]} look={idBranch && !idBranchWait ? (b?.fb?.sel ? 'exmem' : 'normal') : 'faded'} />
        <ellipse cx={CMP.cx} cy={CMP.cy} rx={CMP.rx} ry={CMP.ry} fill="white" stroke={idBranchWait ? COLORS.hazard : b ? (b.equal ? COLORS.branch : COLORS.data) : COLORS.faded} strokeWidth={b ? 4.5 : 2.6} />
        <text x={CMP.cx} y={CMP.cy + 14} textAnchor="middle" fontFamily={FONT} fontSize={40} fontWeight={700} fill={idBranchWait ? COLORS.hazard : b ? COLORS.data : COLORS.fadedText}>=</text>
        <AndGate x={1240} y={600} w={48} h={54} look={idBranch ? (taken ? 'branch' : 'normal') : 'faded'} />
        <Oval cx={1280} cy={850} rx={56} ry={26} lines={['Shift left 2']} look={idBranch ? 'normal' : 'faded'} size={15} />
        <Adder lx={1360} lt={735} lb={875} rx={1425} rt={765} rb={845} look={idBranch ? (taken ? 'branch' : 'normal') : 'faded'}>
          <Label x={1396} y={812} look={idBranch ? 'normal' : 'faded'} bold anchor="middle" size={20}>Add</Label>
        </Adder>
      </g>}

      {/* ---------- EX units ---------- */}
      <g opacity={op(['ex'])} transform={sh(1140)}>
        <MuxN x={1140} y={505} w={50} h={140} inputs={[{ t: '00', y: 540 }, { t: '01', y: 578 }, { t: '10', y: 616 }]} look={on(E)} />
        <MuxN x={1140} y={680} w={50} h={140} inputs={[{ t: '00', y: 715 }, { t: '01', y: 753 }, { t: '10', y: 791 }]} look={on(E && bUsed)} />
        <Mux x={1270} y={715} w={36} h={110} top="0" bottom="1" look={on(E)} />
        <Adder lx={1330} lt={480} lb={820} rx={1440} rt={570} rb={730} look={on(E)}>
          <Label x={1392} y={660} look={on(E)} bold anchor="middle" size={24}>ALU</Label>
          {E && ex && <Label x={1392} y={688} look="normal" anchor="middle" size={19}>{ex.aluCtl.name}</Label>}
        </Adder>
        <Oval cx={1385} cy={900} rx={50} ry={32} lines={['ALU', 'control']} look={on(E)} kind="ctrl" size={15} />
        <Mux x={1480} y={925} w={36} h={110} top="0" bottom="1" look={on(E && E.ctrl.RegWrite)} />
      </g>
      <g opacity={op(['fu'])} transform={sh(1290)}>
        <Oval cx={FU.cx} cy={FU.cy} rx={FU.rx} ry={FU.ry} lines={['Forwarding', 'unit']} look={E && showFwd && (any10 || any01) ? (any10 ? 'exmem' : 'memwb') : on(E)} kind="ctrl" size={21} />
      </g>

      {/* ---------- MEM / WB units ---------- */}
      <g opacity={op(['mem'])} transform={sh(1690)}>
        <Box x={1690} y={560} w={170} h={310} look={on(memOp)}>
          <Label x={1698} y={642} look={on(memOp)} size={19}>Address</Label>
          <Label x={1852} y={642} look={on(memOp)} size={19} anchor="end">Read</Label>
          <Label x={1852} y={664} look={on(memOp)} size={19} anchor="end">data</Label>
          <Label x={1698} y={838} look={on(memOp)} size={19}>Write data</Label>
          <Label x={1775} y={722} look={on(memOp)} size={22} bold anchor="middle">Data</Label>
          <Label x={1775} y={748} look={on(memOp)} size={22} bold anchor="middle">memory</Label>
        </Box>
      </g>
      <g opacity={op(['wb'])} transform={sh(1990)}>
        <Mux x={1990} y={622} w={40} h={306} top="1" bottom="0" look={on(Wb && Wb.ctrl.RegWrite)} />
      </g>

      {bar('ifid', ifid, null, [], stall)}
      {bar('idex', idex, idex?.ctrl ?? null, ['WB', 'M', 'EX'])}
      {bar('exmem', exmem, exmem?.ctrl ?? null, ['WB', 'M'])}
      {bar('memwb', memwb, memwb?.ctrl ?? null, ['WB'])}

      {/* ---------- signal names (as on the slides) ---------- */}
      <g opacity={op(['hdu', 'pc'])}>
        <Halo x={83} y={405} rotate anchor="middle" color={stall ? COLORS.hazard : COLORS.ctrl} bold={stall}>{`PCWrite${values && hz.checked ? ` = ${c.pcWrite}` : ''}`}</Halo>
        <Halo x={ifidWriteX - 8} y={137} anchor="end" color={stall ? COLORS.hazard : COLORS.ctrl} bold={stall}>{`IF/IDWrite${values && hz.checked ? ` = ${c.ifidWrite}` : ''}`}</Halo>
        <Halo x={940} y={212} color={asked ? COLORS.hazard : COLORS.ctrl} bold={asked}>{`Stall${values && hz.checked ? ` = ${+asked}` : ''}`}</Halo>
        <Halo x={X(1052)} y={108} size={16} anchor="end">{BR === 'id' ? 'ID/EX.MemRead, RegWrite' : 'ID/EX.MemRead'}</Halo>
        <Halo x={X(1052)} y={134} size={16} anchor="end" color="#212529">{BR === 'id' ? 'ID/EX.RegisterRt, Rd, RegDst' : 'ID/EX.RegisterRt'}</Halo>
        <Halo x={530} y={149} size={16} color="#212529">IF/ID.RegisterRs</Halo>
        <Halo x={538} y={192} size={16} color="#212529">IF/ID.RegisterRt</Halo>
        {BR === 'id' && <Halo x={X(1585)} y={62} size={16} anchor="end" color="#212529">EX/MEM.MemRead, RegisterRd (branch check, slides 80–81)</Halo>}
      </g>
      <g opacity={op(['id'])}>
        <Halo x={480} y={892} size={16} color="#212529">[15–0]</Halo>
        <Halo x={790} y={935} size={17} color="#212529">{`IF/ID.RegisterRs${values && D ? ` = ${regName(D.rs)}` : ''}`}</Halo>
        <Halo x={790} y={960} size={17} color="#212529">{`IF/ID.RegisterRt${values && D ? ` = ${regName(D.rt)}` : ''}`}</Halo>
        <Halo x={790} y={995} size={17} color="#212529">{`IF/ID.RegisterRd${values && D ? ` = ${regName(D.rd)}` : ''}`}</Halo>
        <Halo x={896} y={422} size={17} color="#212529">PC + 4</Halo>
      </g>
      <g opacity={op(['ex', 'fu'])} transform={sh(1160)}>
        <Halo x={1280} y={706} size={17} anchor="end">ALUSrc</Halo>
        <Halo x={1453} y={800} size={17} rotate anchor="middle">ALUOp</Halo>
        <Halo x={1491} y={800} size={17} rotate anchor="middle">RegDst</Halo>
        <Halo x={1212} y={1050} size={18} bold={fa !== '00'} color={E && fa !== '00' ? COLORS[fwdLook(fa) as 'exmem'] : COLORS.ctrl}>{`ForwardA${values && E ? ` = ${fa}` : ''}`}</Halo>
        <Halo x={1157} y={1064} size={17} anchor="end" bold={fb !== '00'} color={E && fb !== '00' ? COLORS[fwdLook(fb) as 'exmem'] : COLORS.ctrl}>{`ForwardB${values && E ? ` = ${fb}` : ''}`}</Halo>
        <Halo x={1440} y={1074} size={16}>EX/MEM.RegWrite</Halo>
        <Halo x={1440} y={1099} size={16} color="#212529">EX/MEM.RegisterRd</Halo>
        <Halo x={1440} y={1124} size={16}>MEM/WB.RegWrite</Halo>
        <Halo x={1400} y={1189} size={16} color="#212529">MEM/WB.RegisterRd</Halo>
        <Halo x={1160} y={1216} size={16} color={(any10 && showFwd) || busCmp ? COLORS.exmem : '#868e96'}>{BR === 'id' ? 'EX/MEM.ALUResult → 10 and → comparator' : 'EX/MEM.ALUResult → 10'}</Halo>
        <Halo x={1160} y={1272} size={16} color={any01 && showFwd ? COLORS.memwb : '#868e96'}>MEM/WB value → 01</Halo>
      </g>
      <g opacity={op(['mem'])} transform={sh(1740)}>
        <Halo x={1733} y={470} rotate size={17} anchor="middle">MemWrite</Halo>
        <Halo x={1803} y={470} rotate size={17} anchor="middle">MemRead</Halo>
      </g>
      <g opacity={op(['wb', 'rf'])}>
        <Halo x={X(2003)} y={500} rotate size={17} anchor="middle">MemtoReg</Halo>
        <Halo x={X(1480)} y={231} size={17}>RegWrite</Halo>
      </g>
      {BR && <g opacity={op(['br', 'pc'])}>
        <Halo x={-100} y={PCSRC_Y - 8} size={17} color={c.pcSrc ? COLORS.branch : COLORS.ctrl} bold={!!c.pcSrc}>{`PCSrc${values && (b || c.waiting) ? ` = ${c.pcSrc}` : ''}`}</Halo>
        <Halo x={-180} y={TARGET_Y - 8} size={17} color={taken ? COLORS.branch : '#212529'} bold={taken}>{`Branch target${values && b ? ` = ${b.target}` : ''}`}</Halo>
        <Halo x={438} y={PCSRC_Y + 50} size={17} color={ifFlush ? COLORS.flush : COLORS.ctrl} bold={ifFlush}>{`IF.Flush${values && (b || c.waiting) ? ` = ${+ifFlush}` : ''}`}</Halo>
        {BR === 'mem' && <>
          <Halo x={1028} y={PCSRC_Y + 50} size={17} color={flushing && c.at.ifid ? COLORS.flush : COLORS.ctrl} bold={flushing}>ID.Flush</Halo>
          <Halo x={X(1560) + 8} y={PCSRC_Y + 50} size={17} color={flushing && c.at.idex ? COLORS.flush : COLORS.ctrl} bold={flushing}>EX.Flush</Halo>
          <Halo x={1840} y={384 - 6} size={15} anchor="end">Branch</Halo>
          <Halo x={1848} y={603} size={15} anchor="end" color="#212529">Zero</Halo>
          <Halo x={X(1446)} y={603} size={15} color="#212529">Zero</Halo>
          <Halo x={1215} y={452} size={15} color="#212529">target</Halo>
        </>}
        {BR === 'id' && <>
          <Halo x={1218} y={392} size={15}>Branch</Halo>
          <Halo x={1200} y={664} size={15} color="#212529">Equal</Halo>
          <Halo x={1040} y={442} size={14} anchor="middle" color={b?.fa?.sel ? COLORS.exmem : COLORS.ctrl}>{`ForwardC${values && b?.fa ? ` = ${b.fa.sel}` : ''}`}</Halo>
          <Halo x={1040} y={832} size={14} anchor="middle" color={b?.fb?.sel ? COLORS.exmem : COLORS.ctrl}>{`ForwardD${values && b?.fb ? ` = ${b.fb.sel}` : ''}`}</Halo>
        </>}
      </g>}

      {/* ---------- bubble markers (slide 71: "make all control fields 0") ---------- */}
      {(idex?.bubble || idex?.squashed) && <g opacity={op(['ex'])}><Tag x={X(1290)} y={455} text={idex.squashed ? (idex.bubble ? 'flushed: EX, MEM, WB do nothing' : 'nop left by IF.Flush: does nothing') : 'bubble: EX, MEM, WB do nothing'} color={idex.squashed ? COLORS.flush : '#868e96'} /></g>}
      {(exmem?.bubble || exmem?.squashed) && <g opacity={op(['mem'])}><Tag x={X(1775)} y={530} text={exmem.squashed ? 'flushed' : 'bubble'} color={exmem.squashed ? COLORS.flush : '#868e96'} /></g>}
      {(memwb?.bubble || memwb?.squashed) && <g opacity={op(['wb'])}><Tag x={X(2010)} y={600} text={memwb.squashed ? 'flushed' : 'bubble'} color={memwb.squashed ? COLORS.flush : '#868e96'} /></g>}

      {/* ---------- values ---------- */}
      {show(['pc']) && <Tag x={90} y={732} text={`PC = ${c.at.pc}`} color={stall ? COLORS.hazard : '#212529'} />}
      {BR && show(['pc', 'br']) && (b || c.waiting) && <Tag x={-100} y={760} text={`next PC = ${c.next.pc}`} color={c.pcSrc ? COLORS.branch : '#212529'} />}
      {show(['if']) && F && <>
        <Tag x={270} y={795} text={hex(F.word)} />
        <Tag x={365} y={420} text={`${c.fetch.pc4}`} />
      </>}
      {show(['id']) && D && c.id && <>
        <Tag x={940} y={530} text={`${regName(D.rs)} = ${c.id.data1}`} color={c.id.sameCycleRs ? COLORS.rf : '#212529'} />
        <Tag x={940} y={705} text={`${regName(D.rt)} = ${c.id.data2}`} color={c.id.sameCycleRt ? COLORS.rf : '#212529'} />
        <Tag x={888} y={890} text={`${D.imm}`} />
        <Tag x={716} y={290} anchor="start" text={`${ctrlBits(c.id.ctrl, 'WB', D.op)} ${ctrlBits(c.id.ctrl, 'M', undefined, BR === 'mem')} ${ctrlBits(c.id.ctrl, 'EX', D.op)}`} color={COLORS.ctrl} />
      </>}
      {show(['hdu']) && hz.checked && (
        <Tag x={HDU.cx} y={218} color={asked ? COLORS.hazard : COLORS.ctrl}
          text={hz.branch?.stall && !hz.loadUse ? `branch needs ${regName(hz.branch.aluRs || hz.branch.loadRs ? D!.rs : D!.rt)} → STALL`
            : !hz.memRead ? (hz.branch ? 'operands ready → no stall' : 'MemRead = 0 → no stall')
              : hz.loadUse ? `lw rt ${regName(hz.idexRt)} = ${hz.matchRs ? 'rs' : 'rt'} → STALL` : `lw rt ${regName(hz.idexRt)} ≠ rs, rt → no stall`} />
      )}
      {show(['rf']) && phase === 'wb' && writes && c.wb && <Tag x={600} y={468} anchor="start" color={COLORS.rf} text={`1st half: ${regName(c.wb.rd)} ← ${c.wb.value}`} />}
      {show(['rf']) && phase === 'id' && D && c.id && <Tag x={600} y={468} anchor="start" color={COLORS.rf} text={`2nd half: read ${regName(D.rs)}, ${regName(D.rt)}`} />}
      {showFwd && E && ex && ex.fa.double && <g opacity={op(['fu'])}><Tag x={X(1165)} y={494} text={`${c.wb!.value} ✘ older`} color={COLORS.memwb} /></g>}
      {showFwd && E && ex && ex.fb.double && <g opacity={op(['fu'])}><Tag x={X(1094)} y={741} anchor="end" text={`${c.wb!.value} ✘ older`} color={COLORS.memwb} /></g>}
      {show(['ex']) && E && ex && <g transform={sh(1300)}>
        <Tag x={1248} y={563} text={`${ex.aluA}`} color={fa === '00' ? '#212529' : COLORS[fwdLook(fa) as 'exmem']} />
        <Label x={1392} y={605} look="normal" anchor="middle" size={18}>{`A = ${ex.aluA}`}</Label>
        <Label x={1386} y={735} look="normal" anchor="middle" size={18}>{`B = ${ex.aluB}`}</Label>
        <Tag x={1492} y={638} text={`${ex.result}`} />
        {E.ctrl.MemWrite ? <Tag x={1400} y={833} text={`${ex.writeData}`} color={fb === '00' ? '#212529' : COLORS[fwdLook(fb) as 'exmem']} /> : null}
        {E.ctrl.RegWrite ? <Tag x={1474} y={990} anchor="end" text={`dest ${regName(ex.regDst)}`} /> : null}
      </g>}
      {show(['ex', 'br']) && exBranch && ex && <>
        <Tag x={1160} y={380} text={`target ${ex.target}`} color={COLORS.branch} />
        <Tag x={X(1490)} y={598} text={`Zero = ${ex.zero}`} color={COLORS.branch} />
      </>}
      {show(['br']) && BR === 'mem' && M?.ctrl.Branch ? <Tag x={1911} y={490} text={`PCSrc = ${c.pcSrc}`} color={taken ? COLORS.branch : '#212529'} /> : null}
      {show(['br', 'id']) && BR === 'id' && idBranch && (idBranchWait
        ? <Tag x={CMP.cx} y={712} text="waits" color={COLORS.hazard} />
        : b && <>
          <Tag x={1063} y={565} text={`${b.a}`} color={b.fa?.sel ? COLORS.exmem : '#212529'} />
          <Tag x={1063} y={700} text={`${b.b}`} color={b.fb?.sel ? COLORS.exmem : '#212529'} />
          <Tag x={1264} y={690} text={b.equal ? 'equal' : 'not equal'} color={b.equal ? COLORS.branch : '#212529'} />
          <Tag x={1392} y={720} text={`${b.target}`} color={taken ? COLORS.branch : '#212529'} />
        </>)}
      {show(['mem']) && M && c.mem && <g transform={sh(1775)}>
        <Label x={1775} y={784} look="normal" anchor="middle" size={18}>{`Mem[${c.mem.address}]`}</Label>
        <Label x={1775} y={807} look={c.mem.read ? 'normal' : 'exmem'} anchor="middle" size={18} bold>{c.mem.read ? `read ${c.mem.readData}` : `← ${M.writeData} at edge`}</Label>
      </g>}
      {show(['wb']) && Wb && c.wb && Wb.ctrl.RegWrite ? <Tag x={X(2065)} y={1000} anchor="end" text={`${c.wb.value}`} color={phase === 'wb' ? COLORS.rf : '#212529'} /> : null}
    </svg>
  )
}
