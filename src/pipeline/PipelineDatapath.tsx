// The pipelined datapath with forwarding and hazard detection, drawn like
// Chapter 4 Part 2 slides 52, 65 and 75 (Patterson & Hennessy Fig. 4.51/4.56/4.60)
// with the shapes of the single-cycle lessons. Branch hardware is left out until
// the control-hazard lesson.

import type { ReactNode } from 'react'
import { Adder, Box, COLORS, Label, Mux, MuxN, Oval, Wire, hot, type Look } from '../datapath/shapes'
import { regName, hex, dontCare, type Controls, type Cycle, type Instr } from './engine'
import type { Phase } from './explain'
import { instrColor, tint } from './colors'

type Group = 'pc' | 'if' | 'id' | 'hdu' | 'ex' | 'fu' | 'mem' | 'wb' | 'rf' | 'regs'
type Pt = [number, number]

/** What each sub-step of a cycle puts in the spotlight. */
const SPOT: Record<Phase, Group[]> = {
  edge: ['regs', 'pc'],
  wb: ['wb', 'rf'],
  id: ['pc', 'if', 'id', 'hdu', 'rf'],
  ex: ['ex', 'fu', 'mem'],
}


const W = 2320
const H = 1350
const MONO = 'Consolas, ui-monospace, monospace'
const FONT = 'Arial, Helvetica, sans-serif'

// Pipeline registers: x, width, top of the bar (the control boxes form a staircase as on slide 52).
const REG = {
  ifid: { x: 470, w: 36, top: 330, name: 'IF/ID' },
  idex: { x: 1130, w: 40, top: 330, name: 'ID/EX' },
  exmem: { x: 1710, w: 40, top: 370, name: 'EX/MEM' },
  memwb: { x: 2080, w: 40, top: 410, name: 'MEM/WB' },
}
const BOTTOM = 1130
// A pipeline register is lit whenever a stage that reads or writes it is in the spotlight.
const BAR_GROUPS: Record<keyof typeof REG, Group[]> = {
  ifid: ['regs', 'if', 'id', 'hdu'],
  idex: ['regs', 'id', 'hdu', 'ex'],
  exmem: ['regs', 'ex', 'mem', 'fu'],
  memwb: ['regs', 'mem', 'wb', 'fu'],
}

// Ellipses that wires start or end on.
const HDU = { cx: 850, cy: 180, rx: 115, ry: 55 }
const FU = { cx: 1420, cy: 1205, rx: 125, ry: 45 }
type Ell = typeof HDU
const xAt = (e: Ell, y: number, side: -1 | 1) => e.cx + side * e.rx * Math.sqrt(Math.max(0, 1 - ((y - e.cy) / e.ry) ** 2))
const yAt = (e: Ell, x: number, side: -1 | 1) => e.cy + side * e.ry * Math.sqrt(Math.max(0, 1 - ((x - e.cx) / e.rx) ** 2))

const fwdLook = (sel: string): Look => (sel === '10' ? 'exmem' : sel === '01' ? 'memwb' : 'normal')
const rank = (l: Look) => (l === 'faded' ? 0 : hot(l) ? 2 : 1)

function ctrlBits(c: Controls, part: 'WB' | 'M' | 'EX', op?: Instr['op']) {
  const x = dontCare(op)
  const b = (k: keyof Controls, v: string) => (x.includes(k) ? 'X' : v)
  if (part === 'WB') return b('RegWrite', String(c.RegWrite)) + b('MemtoReg', String(c.MemtoReg))
  if (part === 'M') return String(c.MemRead) + String(c.MemWrite)
  return b('RegDst', String(c.RegDst)) + c.ALUOp.toString(2).padStart(2, '0') + String(c.ALUSrc)
}

/** Small value tag (monospace, white box) placed over the diagram. */
function Tag({ x, y, text, color = '#212529', anchor = 'middle', bold = true }: { x: number; y: number; text: string; color?: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean }) {
  const w = text.length * 9.6 + 14
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w
  return (
    <g fontFamily={MONO} pointerEvents="none">
      <rect x={left} y={y - 18} width={w} height={25} rx={6} fill="white" stroke={color} strokeWidth={1.8} />
      <text x={left + 7} y={y} fontSize={17} fontWeight={bold ? 700 : 400} fill={color}>{text}</text>
    </g>
  )
}

/** Label with a white halo so it stays readable where it crosses wires. */
function Halo({ x, y, children, color = COLORS.ctrl, size = 16, anchor = 'start', rotate = false, bold = false }: { x: number; y: number; children: ReactNode; color?: string; size?: number; anchor?: 'start' | 'middle' | 'end'; rotate?: boolean; bold?: boolean }) {
  return (
    <text x={x} y={y} fontFamily={FONT} fontSize={size} fontWeight={bold ? 700 : 400} fill={color} textAnchor={anchor}
      stroke="white" strokeWidth={4} paintOrder="stroke" transform={rotate ? `rotate(-90 ${x} ${y})` : undefined}>
      {children}
    </text>
  )
}

export function PipelineDatapath({ cycle: c, phase, spotlight, values }: { cycle: Cycle; phase: Phase; spotlight: boolean; values: boolean }) {
  const { ifid, idex, exmem, memwb } = c.at
  const F = c.fetch.instr
  const D = ifid?.instr ?? null
  const E = idex && !idex.bubble ? idex : null
  const M = exmem && !exmem.bubble ? exmem : null
  const Wb = memwb && !memwb.bubble ? memwb : null
  const stall = c.hazard.stall
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
  const op = (gs: Group[]) => (lit(gs) ? 1 : 0.2)
  const showFwd = !spotlight || phase === 'ex'
  const show = (gs: Group[]) => values && lit(gs)

  type WireDef = { pts: Pt[]; look: Look; g: Group[]; kind?: 'data' | 'ctrl'; thick?: boolean; arrow?: boolean; dots?: Pt[] }
  const wires: WireDef[] = []
  const w = (g: Group[], look: Look, pts: Pt[], opts: Partial<WireDef> = {}) => wires.push({ g, look, pts, ...opts })
  const ctl = { kind: 'ctrl' as const, arrow: true }

  // ---------- IF ----------
  w(['if', 'pc'], on(F), [[155, 700], [200, 700]], { dots: [[175, 700]] })
  w(['if'], on(F), [[175, 700], [175, 410], [230, 410]])
  w(['if'], on(F), [[195, 510], [230, 510]])
  w(['if'], on(F), [[320, 460], [470, 460]], { dots: [[345, 460]] })
  w(['if', 'pc'], on(F && !stall), [[345, 460], [345, 300], [60, 300], [60, 700], [95, 700]])
  w(['if'], on(F), [[390, 700], [470, 700]])

  // ---------- ID ----------
  w(['id'], on(D), [[506, 700], [530, 700]], { arrow: false, dots: [[530, 700]] })
  w(['id'], on(D), [[530, 1105], [530, 385], [645, 385]])
  w(['id'], on(D), [[530, 600], [640, 600]], { dots: [[530, 600]] })
  w(['id'], on(D), [[530, 680], [640, 680]], { dots: [[530, 680]] })
  w(['id'], on(D), [[530, 960], [715, 960]], { dots: [[530, 960]] })
  w(['id'], on(D), [[815, 960], [1130, 960]])
  w(['id'], on(D), [[530, 1035], [1130, 1035]], { dots: [[530, 1035]] })
  w(['id'], on(D), [[530, 1065], [1130, 1065]], { dots: [[530, 1065]] })
  w(['id'], on(D), [[530, 1105], [1130, 1105]])
  w(['id'], on(D, c.id?.sameCycleRs ? 'rf' : 'normal'), [[890, 620], [1130, 620]])
  w(['id'], on(D, c.id?.sameCycleRt ? 'rf' : 'normal'), [[890, 820], [1130, 820]])
  w(['id'], on(D), [[506, 460], [1130, 460]])
  w(['id'], on(D && !stall), [[735, 385], [1000, 385], [1000, 350], [1040, 350]], ctl)
  w(['id', 'hdu'], stall ? 'hazard' : 'faded', [[1022, 430], [1040, 430]], ctl)
  const ctrlOut: Look = D ? (stall ? 'hazard' : 'normal') : 'faded'
  w(['id'], ctrlOut, [[1080, 390], [1100, 390], [1100, 350], [1130, 350]], { ...ctl, dots: [[1100, 390]] })
  w(['id'], ctrlOut, [[1080, 390], [1130, 390]], ctl)
  w(['id'], ctrlOut, [[1100, 390], [1100, 430], [1130, 430]], ctl)

  // ---------- hazard detection unit (slide 75) ----------
  const hz = c.hazard
  const hzIn = (match: boolean): Look => (!hz.checked ? 'faded' : stall && match ? 'hazard' : 'normal')
  w(['hdu'], hzIn(hz.matchRs), [[560, 600], [560, 190], [xAt(HDU, 190, -1), 190]], { dots: [[560, 600]] })
  w(['hdu'], hzIn(hz.matchRt), [[580, 680], [580, 210], [xAt(HDU, 210, -1), 210]], { dots: [[580, 680]] })
  w(['hdu'], idex ? (stall ? 'hazard' : 'normal') : 'faded', [[1182, 390], [1182, 165], [xAt(HDU, 165, 1), 165]], { ...ctl, dots: [[1182, 390]] })
  w(['hdu'], idex ? (stall ? 'hazard' : 'normal') : 'faded', [[1170, 490], [1196, 490], [1196, 145], [xAt(HDU, 145, 1), 145]])
  w(['hdu', 'pc'], stall ? 'hazard' : 'normal', [[xAt(HDU, 155, -1), 155], [125, 155], [125, 640]], ctl)
  w(['hdu'], stall ? 'hazard' : 'normal', [[xAt(HDU, 172, -1), 172], [488, 172], [488, REG.ifid.top]], ctl)
  w(['hdu'], stall ? 'hazard' : 'normal', [[xAt(HDU, 210, 1), 210], [1060, 210], [1060, 325]], ctl)

  // ---------- EX ----------
  w(['ex'], on(E), [[1170, 350], [1690, 350], [1690, 390], [1710, 390]], ctl)
  w(['ex'], on(E), [[1170, 390], [1680, 390], [1680, 430], [1710, 430]], ctl)
  w(['ex'], on(E), [[1170, 420], [1418, 420], [1418, 835]], ctl)
  w(['ex'], on(E), [[1170, 432], [1620, 432], [1620, 1022], [1540, 1022], [1540, 1010]], { ...ctl, thick: true })
  w(['ex'], on(E && E.ctrl.RegWrite), [[1170, 444], [1668, 444], [1668, 1040]], ctl)
  w(['ex'], on(E && fa === '00'), [[1170, 620], [1290, 620]])
  w(['ex'], on(E && fb === '00' && bUsed), [[1170, 820], [1290, 820]])
  w(['ex'], E ? fwdLook(fa) : 'faded', [[1340, 665], [1480, 665]])
  w(['ex'], E && bUsed ? fwdLook(fb) : 'faded', [[1340, 865], [1366, 865]], { arrow: false, dots: [[1366, 865]] })
  w(['ex'], E && !E.ctrl.ALUSrc ? fwdLook(fb) : 'faded', [[1366, 865], [1400, 865]])
  w(['ex'], E?.ctrl.MemWrite ? fwdLook(fb) : 'faded', [[1366, 865], [1366, 930], [1710, 930]])
  w(['ex'], on(E), [[1170, 960], [1499, 960]], { dots: [[1382, 960]] })
  w(['ex'], on(E?.ctrl.ALUSrc), [[1382, 960], [1382, 905], [1400, 905]])
  w(['ex'], on(E), [[1436, 885], [1480, 885]])
  w(['ex'], on(E), [[1600, 760], [1710, 760]])
  w(['ex'], on(E), [[1540, 940], [1540, 876]], { ...ctl, thick: true })
  w(['ex', 'fu'], on(E), [[1170, 1065], [1198, 1065]], { arrow: false, dots: [[1198, 1065]] })
  w(['ex'], on(E && E.ctrl.RegWrite && !E.ctrl.RegDst), [[1198, 1065], [1650, 1065]])
  w(['ex'], on(E && E.ctrl.RegWrite && E.ctrl.RegDst), [[1170, 1105], [1650, 1105]])
  w(['ex'], on(E && E.ctrl.RegWrite), [[1686, 1085], [1710, 1085]])

  // ---------- forwarding unit (slides 61–65) ----------
  const fuIn = (sel: string, src: '10' | '01'): Look => (!E ? 'faded' : showFwd && sel === src ? fwdLook(src) : 'normal')
  const rsIn: Look = !E ? 'faded' : showFwd && fa !== '00' ? fwdLook(fa) : 'normal'
  const rtIn: Look = !E ? 'faded' : showFwd && fb !== '00' && !ex?.fb.unused ? fwdLook(fb) : 'normal'
  w(['fu'], rsIn, [[1170, 1035], [1212, 1035], [1212, 1190], [xAt(FU, 1190, -1), 1190]])
  w(['fu'], rtIn, [[1198, 1065], [1198, 1220], [xAt(FU, 1220, -1), 1220]])
  const exSrc = E && exmem ? fuIn(any10 ? '10' : '', '10') : 'faded'
  const memSrc = E && memwb ? fuIn(any01 ? '01' : '', '01') : 'faded'
  w(['fu', 'mem'], exSrc, [[1765, 390], [1765, 1168], [xAt(FU, 1168, 1), 1168]], { ...ctl, dots: [[1765, 390]] })
  w(['fu', 'mem'], exSrc, [[1780, 1085], [1780, 1200], [xAt(FU, 1200, 1), 1200]], { dots: [[1780, 1085]] })
  w(['fu', 'wb'], memSrc, [[2135, 430], [2135, 1232], [xAt(FU, 1232, 1), 1232]], ctl)
  w(['fu', 'wb'], memSrc, [[1480, 1290], [1480, yAt(FU, 1480, 1)]], { dots: [[1480, 1290]] })
  w(['fu'], E ? (fa === '00' ? 'normal' : fwdLook(fa)) : 'faded', [[1352, yAt(FU, 1352, -1)], [1352, 765], [1315, 765], [1315, 740]], ctl)
  w(['fu'], E ? (fb === '00' ? 'normal' : fwdLook(fb)) : 'faded', [[1315, yAt(FU, 1315, -1)], [1315, 940]], ctl)
  // EX/MEM.ALUResult → the "10" inputs; MEM/WB value → the "01" inputs.
  // Forwarding paths are only coloured in the EX step (or with the spotlight off).
  const busA10 = showFwd && E && fa === '10', busB10 = showFwd && E && fb === '10' && bUsed
  const busA01 = showFwd && E && fa === '01', busB01 = showFwd && E && fb === '01' && bUsed
  w(['fu', 'mem'], busA10 || busB10 ? 'exmem' : 'faded', [[1795, 1000], [1795, 1270], [1245, 1270], [1245, 910]], { arrow: false, dots: [[1245, 910]] })
  w(['fu'], busA10 ? 'exmem' : 'faded', [[1245, 910], [1245, 710], [1290, 710]])
  w(['fu'], busB10 ? 'exmem' : 'faded', [[1245, 910], [1290, 910]])
  w(['fu', 'wb'], busA01 || busB01 ? 'memwb' : 'faded', [[1225, 1320], [1225, 865]], { arrow: false, dots: [[1225, 1320], [1225, 865]] })
  w(['fu'], busA01 ? 'memwb' : 'faded', [[1225, 865], [1225, 665], [1290, 665]])
  w(['fu'], busB01 ? 'memwb' : 'faded', [[1225, 865], [1290, 865]])

  // ---------- MEM ----------
  w(['mem'], on(M), [[1750, 390], [2060, 390], [2060, 430], [2080, 430]], ctl)
  w(['mem'], on(M), [[1750, 430], [2040, 430], [2040, 975], [1960, 975], [1960, 960]], ctl)
  w(['mem'], on(M), [[1930, 430], [1930, 700]], { ...ctl, dots: [[1930, 430]] })
  const exmemOut: Look = showFwd && (busA10 || busB10) ? 'exmem' : on(M)
  w(['mem', 'fu'], exmemOut, [[1750, 760], [1795, 760]], { arrow: false, dots: [[1795, 760]] })
  w(['mem'], on(memOp), [[1795, 760], [1850, 760]])
  w(['mem', 'fu'], showFwd && (busA10 || busB10) ? 'exmem' : on(M && M.ctrl.RegWrite && !M.ctrl.MemRead), [[1795, 760], [1795, 1000]], { arrow: false, dots: [[1795, 1000]] })
  w(['mem'], on(M && M.ctrl.RegWrite && !M.ctrl.MemRead), [[1795, 1000], [2080, 1000]])
  w(['mem'], on(M?.ctrl.MemWrite), [[1750, 930], [1850, 930]])
  w(['mem'], on(M?.ctrl.MemRead), [[2020, 760], [2080, 760]])
  w(['mem'], on(M && M.ctrl.RegWrite), [[1750, 1085], [2080, 1085]])

  // ---------- WB (slide 55: write in the first half) ----------
  w(['wb'], on(Wb), [[2120, 430], [2135, 430]], { ...ctl, arrow: false, dots: [[2135, 430]] })
  w(['wb', 'rf'], rfLook(Wb?.ctrl.RegWrite), [[2135, 430], [2135, 290], [765, 290], [765, 560]], ctl)
  w(['wb'], on(Wb?.ctrl.RegWrite), [[2135, 430], [2220, 430], [2220, 738]], ctl)
  w(['wb'], on(Wb?.ctrl.MemtoReg), [[2120, 760], [2200, 760]])
  w(['wb'], on(Wb && Wb.ctrl.RegWrite && !Wb.ctrl.MemtoReg), [[2120, 1000], [2165, 1000], [2165, 840], [2200, 840]])
  const wbOut: Look = showFwd && (busA01 || busB01) && phase !== 'wb' ? 'memwb' : rfLook(Wb?.ctrl.RegWrite)
  w(['wb', 'fu'], wbOut, [[2240, 800], [2270, 800], [2270, 1320], [1225, 1320]], { arrow: false })
  w(['wb', 'rf'], rfLook(writes), [[1225, 1320], [610, 1320], [610, 830], [640, 830]])
  const rdOut: Look = showFwd && (busA01 || busB01) && phase !== 'wb' ? 'memwb' : rfLook(Wb?.ctrl.RegWrite)
  w(['wb', 'fu'], rdOut, [[2120, 1085], [2150, 1085], [2150, 1290], [1480, 1290]], { arrow: false })
  w(['wb', 'rf'], rfLook(writes), [[1480, 1290], [625, 1290], [625, 760], [640, 760]])

  wires.sort((a, b) => rank(a.look) - rank(b.look))

  // ---------- pipeline registers ----------
  const bar = (key: keyof typeof REG, p: { instr: Instr; bubble?: boolean } | null, ctrl: Controls | null, parts: ('WB' | 'M' | 'EX')[], hold = false) => {
    const r = REG[key]
    const color = p ? (p.bubble ? '#868e96' : instrColor(p.instr)) : '#adb5bd'
    const dataTop = r.top + parts.length * 40
    const label = p ? (p.bubble ? 'bubble · controls = 0' : p.instr.text) : 'empty'
    return (
      <g key={key} opacity={op(BAR_GROUPS[key])}>
        <rect x={r.x} y={dataTop} width={r.w} height={BOTTOM - dataTop} fill={p ? (p.bubble ? 'url(#pl-hatch)' : tint(color, '22')) : '#f8f9fa'}
          stroke={hold ? COLORS.hazard : '#343a40'} strokeWidth={hold ? 5 : 2.4} />
        {parts.map((part, i) => (
          <g key={part}>
            <rect x={r.x} y={r.top + i * 40} width={r.w} height={40} fill={p ? 'white' : '#f8f9fa'} stroke={COLORS.ctrl} strokeWidth={2.2} />
            <text x={r.x + r.w / 2} y={r.top + i * 40 + 15} fontFamily={FONT} fontSize={13} fill={COLORS.ctrl} textAnchor="middle">{part}</text>
            {ctrl && values && <text x={r.x + r.w / 2} y={r.top + i * 40 + 33} fontFamily={MONO} fontSize={14} fontWeight={700} fill={p?.bubble ? COLORS.hazard : COLORS.ctrl} textAnchor="middle">{ctrlBits(ctrl, part, p?.bubble ? undefined : p?.instr.op)}</text>}
          </g>
        ))}
        <text x={r.x + r.w / 2 + 6} y={(dataTop + BOTTOM) / 2} transform={`rotate(-90 ${r.x + r.w / 2 + 6} ${(dataTop + BOTTOM) / 2})`} textAnchor="middle"
          fontFamily={MONO} fontSize={19} fontWeight={700} fill={p ? color : '#adb5bd'}>{label}</text>
        <text x={r.x + r.w / 2} y={r.top - 12} fontFamily={FONT} fontSize={20} fontWeight={700} textAnchor="middle" fill="#212529">{r.name}</text>
        {p && !p.bubble && <g>
          <circle cx={r.x + r.w / 2} cy={BOTTOM + 26} r={17} fill={color} />
          <text x={r.x + r.w / 2} y={BOTTOM + 32} textAnchor="middle" fontFamily={FONT} fontSize={16} fontWeight={700} fill="white">I{p.instr.id + 1}</text>
        </g>}
        {hold && <Tag x={r.x + r.w / 2} y={BOTTOM + 66} text="HOLD" color={COLORS.hazard} />}
      </g>
    )
  }

  // ---------- stage banners ----------
  const stages: { name: string; x0: number; x1: number; who: Instr | null; bubble?: boolean; note?: string }[] = [
    { name: 'IF', x0: 8, x1: 466, who: F, note: F ? (stall ? 'fetched again next cycle' : hex(c.fetch.pc, 4)) : 'no more instructions' },
    { name: 'ID', x0: 510, x1: 1126, who: D, note: D && stall ? 'stalled: decoded again next cycle' : undefined },
    { name: 'EX', x0: 1174, x1: 1706, who: idex?.instr ?? null, bubble: idex?.bubble },
    { name: 'MEM', x0: 1754, x1: 2076, who: exmem?.instr ?? null, bubble: exmem?.bubble },
    { name: 'WB', x0: 2124, x1: 2312, who: memwb?.instr ?? null, bubble: memwb?.bubble },
  ]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pipeline-svg" role="img" aria-label={`Pipelined datapath with forwarding and hazard detection, clock cycle ${c.n}`}>
      <defs>
        <pattern id="pl-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="#f1f3f5" />
          <line x1="0" y1="0" x2="0" y2="10" stroke="#ced4da" strokeWidth="5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="white" />

      {stages.map((s) => {
        const color = s.who && !s.bubble ? instrColor(s.who) : '#868e96'
        return (
          <g key={s.name}>
            <rect x={s.x0} y={8} width={s.x1 - s.x0} height={88} rx={10} fill={s.who ? (s.bubble ? 'url(#pl-hatch)' : tint(color)) : '#f8f9fa'} stroke={s.who ? color : '#dee2e6'} strokeWidth={2} />
            <rect x={s.x0} y={8} width={10} height={88} rx={5} fill={s.who ? color : '#dee2e6'} />
            <text x={s.x0 + 24} y={40} fontFamily={FONT} fontSize={22} fontWeight={700} fill={s.who ? color : '#adb5bd'}>
              {s.name}{s.who && !s.bubble ? `  ·  I${s.who.id + 1}` : ''}
            </text>
            {(() => {
              const text = s.who ? (s.bubble ? 'bubble (nop)' : s.who.text) : '(empty)'
              const room = s.x1 - s.x0 - 34
              return <text x={s.x0 + 24} y={74} fontFamily={MONO} fontSize={21} fontWeight={700} fill={s.who ? (s.bubble ? '#495057' : '#212529') : '#adb5bd'}
                textLength={text.length * 11.6 > room ? room : undefined} lengthAdjust="spacingAndGlyphs">{text}</text>
            })()}
            {s.note && <text x={s.x1 - 12} y={40} fontFamily={FONT} fontSize={16} textAnchor="end" fill={stall && (s.name === 'IF' || s.name === 'ID') ? COLORS.hazard : '#495057'} fontWeight={stall ? 700 : 400}>{s.note}</text>}
            {s.bubble && s.x1 - s.x0 > 400 && <text x={s.x1 - 12} y={40} fontFamily={FONT} fontSize={16} textAnchor="end" fill="#495057">all controls 0 · writes nothing</text>}
          </g>
        )
      })}

      {wires.map((x, i) => (
        <g key={i} opacity={op(x.g)}>
          <Wire pts={x.pts} look={x.look} kind={x.kind} thick={x.thick} arrow={x.arrow ?? true} dots={x.dots} />
        </g>
      ))}

      {/* ---------- IF units ---------- */}
      <g opacity={op(['pc'])}>
        <Box x={95} y={640} w={60} h={120} look={stall ? 'hazard' : 'normal'}>
          <Label x={125} y={708} look={stall ? 'hazard' : 'normal'} bold anchor="middle" size={22}>PC</Label>
        </Box>
      </g>
      <g opacity={op(['if'])}>
        <Box x={200} y={600} w={190} h={220} look={on(F)}>
          <Label x={210} y={690} look={on(F)} size={17}>Read</Label>
          <Label x={210} y={710} look={on(F)} size={17}>address</Label>
          <Label x={382} y={690} look={on(F)} size={17} anchor="end">Instruction</Label>
          <Label x={295} y={780} look={on(F)} size={19} bold anchor="middle">Instruction</Label>
          <Label x={295} y={803} look={on(F)} size={19} bold anchor="middle">memory</Label>
        </Box>
        <Adder lx={230} lt={380} lb={540} rx={320} rt={420} rb={500} look={on(F)}>
          <Label x={284} y={468} look={on(F)} bold anchor="middle" size={19}>Add</Label>
        </Adder>
        <Label x={183} y={518} look={on(F)} anchor="middle" size={20}>4</Label>
      </g>

      {/* ---------- ID units ---------- */}
      <g opacity={op(['id'])}>
        <Oval cx={690} cy={385} rx={45} ry={65} lines={['Control']} look={on(D)} kind="ctrl" size={17} />
        <Mux x={1040} y={325} w={40} h={130} top="0" bottom="1" look={on(D, stall ? 'hazard' : 'normal')} />
        <Label x={1012} y={437} look={stall ? 'hazard' : 'faded'} kind="ctrl" anchor="end" size={20}>0</Label>
        <Oval cx={765} cy={960} rx={50} ry={45} lines={['Sign-', 'extend']} look={on(D)} size={16} />
      </g>
      <g opacity={op(['id', 'rf', 'wb'])}>
        <Box x={640} y={560} w={250} h={300} look={on(D || Wb, phase === 'wb' && writes ? 'rf' : 'normal')}>
          <Label x={650} y={605} look="normal" size={16}>Read register 1</Label>
          <Label x={650} y={685} look="normal" size={16}>Read register 2</Label>
          <Label x={650} y={765} look="normal" size={16}>Write register</Label>
          <Label x={650} y={835} look="normal" size={16}>Write data</Label>
          <Label x={882} y={625} look="normal" size={16} anchor="end">Read data 1</Label>
          <Label x={882} y={825} look="normal" size={16} anchor="end">Read data 2</Label>
          <Label x={810} y={725} look="normal" size={20} bold anchor="middle">Registers</Label>
        </Box>
      </g>
      <g opacity={op(['hdu'])}>
        <Oval cx={HDU.cx} cy={HDU.cy} rx={HDU.rx} ry={HDU.ry} lines={['Hazard', 'detection unit']} look={stall ? 'hazard' : 'normal'} kind="ctrl" size={18} />
      </g>

      {/* ---------- EX units ---------- */}
      <g opacity={op(['ex'])}>
        <MuxN x={1290} y={590} w={50} h={150} inputs={[{ t: '00', y: 620 }, { t: '01', y: 665 }, { t: '10', y: 710 }]} look={on(E)} />
        <MuxN x={1290} y={790} w={50} h={150} inputs={[{ t: '00', y: 820 }, { t: '01', y: 865 }, { t: '10', y: 910 }]} look={on(E && bUsed)} />
        <Mux x={1400} y={835} w={36} h={100} top="0" bottom="1" look={on(E)} />
        <Adder lx={1480} lt={600} lb={920} rx={1600} rt={690} rb={830} look={on(E)}>
          <Label x={1545} y={752} look={on(E)} bold anchor="middle" size={21}>ALU</Label>
          {E && ex && <Label x={1545} y={780} look="normal" anchor="middle" size={17}>{ex.aluCtl.name}</Label>}
        </Adder>
        <Oval cx={1540} cy={975} rx={45} ry={35} lines={['ALU', 'control']} look={on(E)} kind="ctrl" size={14} />
        <Mux x={1650} y={1040} w={36} h={90} top="0" bottom="1" look={on(E && E.ctrl.RegWrite)} />
      </g>
      <g opacity={op(['fu'])}>
        <Oval cx={FU.cx} cy={FU.cy} rx={FU.rx} ry={FU.ry} lines={['Forwarding', 'unit']} look={E && showFwd && (any10 || any01) ? (any10 ? 'exmem' : 'memwb') : on(E)} kind="ctrl" size={18} />
      </g>

      {/* ---------- MEM / WB units ---------- */}
      <g opacity={op(['mem'])}>
        <Box x={1850} y={700} w={170} h={260} look={on(memOp)}>
          <Label x={1858} y={752} look={on(memOp)} size={16}>Address</Label>
          <Label x={2012} y={752} look={on(memOp)} size={16} anchor="end">Read data</Label>
          <Label x={1858} y={922} look={on(memOp)} size={16}>Write data</Label>
          <Label x={1935} y={800} look={on(memOp)} size={19} bold anchor="middle">Data</Label>
          <Label x={1935} y={823} look={on(memOp)} size={19} bold anchor="middle">memory</Label>
        </Box>
      </g>
      <g opacity={op(['wb'])}>
        <Mux x={2200} y={735} w={40} h={130} top="1" bottom="0" look={on(Wb && Wb.ctrl.RegWrite)} />
      </g>

      {bar('ifid', ifid ? { instr: ifid.instr } : null, null, [], stall)}
      {bar('idex', idex, idex?.ctrl ?? null, ['WB', 'M', 'EX'])}
      {bar('exmem', exmem, exmem?.ctrl ?? null, ['WB', 'M'])}
      {bar('memwb', memwb, memwb?.ctrl ?? null, ['WB'])}

      {/* ---------- signal names (as on the slides) ---------- */}
      <g opacity={op(['hdu', 'pc'])}>
        <Halo x={118} y={470} rotate color={stall ? COLORS.hazard : COLORS.ctrl} bold={stall}>{`PCWrite${values && hz.checked ? ` = ${c.pcWrite}` : ''}`}</Halo>
        <Halo x={481} y={262} rotate color={stall ? COLORS.hazard : COLORS.ctrl} bold={stall}>{`IF/IDWrite${values && hz.checked ? ` = ${c.ifidWrite}` : ''}`}</Halo>
        <Halo x={1068} y={262} color={stall ? COLORS.hazard : COLORS.ctrl} bold={stall}>{`Stall${values && hz.checked ? ` = ${+stall}` : ''}`}</Halo>
        <Halo x={1010} y={141}>ID/EX.RegisterRt</Halo>
        <Halo x={1010} y={161}>ID/EX.MemRead</Halo>
        <Halo x={553} y={330} rotate size={14} color="#212529">IF/ID.RegisterRs</Halo>
        <Halo x={574} y={470} rotate size={14} color="#212529">IF/ID.RegisterRt</Halo>
      </g>
      <g opacity={op(['id'])}>
        <Halo x={545} y={952} size={14} color="#212529">[15–0]</Halo>
        <Halo x={850} y={1029} size={15} color="#212529">{`IF/ID.RegisterRs${values && D ? ` = ${regName(D.rs)}` : ''}`}</Halo>
        <Halo x={850} y={1059} size={15} color="#212529">{`IF/ID.RegisterRt${values && D ? ` = ${regName(D.rt)}` : ''}`}</Halo>
        <Halo x={850} y={1099} size={15} color="#212529">{`IF/ID.RegisterRd${values && D ? ` = ${regName(D.rd)}` : ''}`}</Halo>
        <Halo x={830} y={453} size={15} color="#212529">PC + 4</Halo>
      </g>
      <g opacity={op(['ex', 'fu'])}>
        <Halo x={1426} y={826} size={15}>ALUSrc</Halo>
        <Halo x={1568} y={1046} size={15}>ALUOp</Halo>
        <Halo x={1662} y={1036} size={15} anchor="end">RegDst</Halo>
        <Halo x={1362} y={792} size={16} bold={fa !== '00'} color={E && fa !== '00' ? COLORS[fwdLook(fa) as 'exmem'] : COLORS.ctrl}>{`ForwardA${values && E ? ` = ${fa}` : ''}`}</Halo>
        <Halo x={1323} y={1004} size={16} bold={fb !== '00'} color={E && fb !== '00' ? COLORS[fwdLook(fb) as 'exmem'] : COLORS.ctrl}>{`ForwardB${values && E ? ` = ${fb}` : ''}`}</Halo>
        <Halo x={1568} y={1163} size={14}>EX/MEM.RegWrite</Halo>
        <Halo x={1568} y={1195} size={14} color="#212529">EX/MEM.RegisterRd</Halo>
        <Halo x={1568} y={1227} size={14}>MEM/WB.RegWrite</Halo>
        <Halo x={1500} y={1284} size={14} color="#212529">MEM/WB.RegisterRd</Halo>
        <Halo x={1258} y={1264} size={14} color={any10 && showFwd ? COLORS.exmem : '#868e96'}>EX/MEM.ALUResult → 10</Halo>
        <Halo x={1258} y={1314} size={14} color={any01 && showFwd ? COLORS.memwb : '#868e96'}>MEM/WB value → 01</Halo>
      </g>
      <g opacity={op(['mem'])}>
        <Halo x={1924} y={560} rotate size={15}>MemWrite</Halo>
        <Halo x={2034} y={600} rotate size={15}>MemRead</Halo>
      </g>
      <g opacity={op(['wb', 'rf'])}>
        <Halo x={2214} y={620} rotate size={15}>MemtoReg</Halo>
        <Halo x={1500} y={284} size={15}>RegWrite</Halo>
      </g>

      {/* ---------- bubble markers (slide 71: "make all control fields 0") ---------- */}
      {idex?.bubble && <g opacity={op(['ex'])}><Tag x={1440} y={540} text="bubble: EX, MEM, WB do nothing" color="#868e96" /></g>}
      {exmem?.bubble && <g opacity={op(['mem'])}><Tag x={1935} y={655} text="bubble" color="#868e96" /></g>}
      {memwb?.bubble && <g opacity={op(['wb'])}><Tag x={2215} y={690} text="bubble" color="#868e96" /></g>}

      {/* ---------- values ---------- */}
      {show(['pc']) && <Tag x={125} y={796} text={`PC = ${c.at.pc}`} color={stall ? COLORS.hazard : '#212529'} />}
      {show(['if']) && F && <>
        <Tag x={295} y={856} text={hex(F.word)} />
        <Tag x={405} y={448} text={`${c.fetch.pc4}`} />
      </>}
      {show(['id']) && D && c.id && <>
        <Tag x={1010} y={608} text={`${regName(D.rs)} = ${c.id.data1}`} color={c.id.sameCycleRs ? COLORS.rf : '#212529'} />
        <Tag x={1010} y={808} text={`${regName(D.rt)} = ${c.id.data2}`} color={c.id.sameCycleRt ? COLORS.rf : '#212529'} />
        <Tag x={975} y={948} text={`${D.imm}`} />
        <Tag x={900} y={373} text={stall ? 'controls → 0' : `${ctrlBits(c.id.ctrl, 'WB', D.op)} ${ctrlBits(c.id.ctrl, 'M')} ${ctrlBits(c.id.ctrl, 'EX', D.op)}`} color={stall ? COLORS.hazard : COLORS.ctrl} />
      </>}
      {show(['hdu']) && hz.checked && (
        <Tag x={HDU.cx} y={262} color={stall ? COLORS.hazard : COLORS.ctrl}
          text={!hz.memRead ? 'ID/EX.MemRead = 0 → no stall' : stall ? `MemRead=1, ${regName(hz.idexRt)} = ${regName(hz.matchRs ? hz.ifidRs : hz.ifidRt)} → STALL` : `MemRead=1, ${regName(hz.idexRt)} ≠ rs, rt → no stall`} />
      )}
      {show(['rf']) && phase === 'wb' && writes && c.wb && <Tag x={775} y={548} anchor="start" color={COLORS.rf} text={`1st half: ${regName(c.wb.rd)} ← ${c.wb.value}`} />}
      {show(['rf']) && phase === 'id' && D && c.id && <Tag x={775} y={548} anchor="start" color={COLORS.rf} text={`2nd half: read ${regName(D.rs)}, ${regName(D.rt)}`} />}
      {showFwd && E && ex && ex.fa.double && <g opacity={op(['fu'])}><Tag x={1284} y={650} anchor="end" text={`${c.wb!.value} ✘ older`} color={COLORS.memwb} /></g>}
      {showFwd && E && ex && ex.fb.double && <g opacity={op(['fu'])}><Tag x={1284} y={850} anchor="end" text={`${c.wb!.value} ✘ older`} color={COLORS.memwb} /></g>}
      {show(['ex']) && E && ex && <>
        <Tag x={1410} y={652} text={`${ex.aluA}`} color={fa === '00' ? '#212529' : COLORS[fwdLook(fa) as 'exmem']} />
        <Tag x={1458} y={985 - 70} text={`${ex.aluB}`} />
        <Tag x={1655} y={748} text={`${ex.result}`} />
        {E.ctrl.MemWrite ? <Tag x={1650} y={922} text={`${ex.writeData}`} color={fb === '00' ? '#212529' : COLORS[fwdLook(fb) as 'exmem']} /> : null}
        {E.ctrl.RegWrite ? <Tag x={1598} y={1140} text={`dest ${regName(ex.regDst)}`} /> : null}
      </>}
      {show(['mem']) && M && c.mem && <>
        <Label x={1935} y={862} look="normal" anchor="middle" size={16}>{`Mem[${c.mem.address}]`}</Label>
        <Label x={1935} y={884} look={c.mem.read ? 'normal' : 'exmem'} anchor="middle" size={16} bold>{c.mem.read ? `read ${c.mem.readData}` : `← ${M.writeData} at edge`}</Label>
      </>}
      {show(['wb']) && Wb && c.wb && Wb.ctrl.RegWrite ? <Tag x={2262} y={930} text={`${c.wb.value}`} color={phase === 'wb' ? COLORS.rf : '#212529'} /> : null}
    </svg>
  )
}
