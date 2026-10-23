// Where the units of the pipelined datapath sit on the sheet, for the studio view:
// the camera frames them, pins point at them and inspect cards open next to them.
// Coordinates are the base sheet of PipelineDatapath (2100 × 1280, data-hazard layout);
// `warp` applies the same x shift the drawing uses when branch hardware widens the sheet.

import type { Hardware } from './engine'

export type Unit =
  | 'pc' | 'imem' | 'ifid' | 'control' | 'stallMux' | 'regs' | 'rfWrite' | 'rfRead' | 'signext' | 'hdu'
  | 'idex' | 'muxA' | 'muxB' | 'aluSrc' | 'alu' | 'aluCtl' | 'regDst' | 'fu' | 'exmem' | 'dmem' | 'memwb' | 'wbMux'

export type Box = { x: number; y: number; w: number; h: number }
/** `box` is what the camera frames; `pin` is where a pin sits. */
type UnitGeo = { box: Box; pin: [number, number]; name: string }

const BOTTOM = 1025
const U: Record<Unit, UnitGeo> = {
  pc: { box: { x: 60, y: 560, w: 60, h: 140 }, pin: [90, 560], name: 'PC' },
  imem: { box: { x: 170, y: 520, w: 200, h: 240 }, pin: [270, 520], name: 'Instruction memory' },
  ifid: { box: { x: 400, y: 270, w: 40, h: BOTTOM - 270 }, pin: [420, 300], name: 'IF/ID' },
  control: { box: { x: 610, y: 260, w: 100, h: 120 }, pin: [660, 262], name: 'Control' },
  stallMux: { box: { x: 910, y: 270, w: 40, h: 120 }, pin: [930, 272], name: 'Control mux (stall)' },
  regs: { box: { x: 590, y: 480, w: 290, h: 290 }, pin: [735, 482], name: 'Registers' },
  rfWrite: { box: { x: 590, y: 480, w: 290, h: 290 }, pin: [592, 746], name: 'Registers (write)' },
  rfRead: { box: { x: 590, y: 480, w: 290, h: 290 }, pin: [878, 540], name: 'Registers (read)' },
  signext: { box: { x: 665, y: 860, w: 110, h: 80 }, pin: [720, 862], name: 'Sign-extend' },
  hdu: { box: { x: 630, y: 92, w: 280, h: 96 }, pin: [770, 120], name: 'Hazard detection unit' },
  idex: { box: { x: 1000, y: 270, w: 40, h: BOTTOM - 270 }, pin: [1020, 300], name: 'ID/EX' },
  muxA: { box: { x: 1140, y: 505, w: 50, h: 140 }, pin: [1165, 507], name: 'ForwardA mux' },
  muxB: { box: { x: 1140, y: 680, w: 50, h: 140 }, pin: [1165, 682], name: 'ForwardB mux' },
  aluSrc: { box: { x: 1270, y: 715, w: 36, h: 110 }, pin: [1288, 717], name: 'ALUSrc mux' },
  alu: { box: { x: 1330, y: 480, w: 110, h: 340 }, pin: [1400, 540], name: 'ALU' },
  aluCtl: { box: { x: 1335, y: 868, w: 100, h: 64 }, pin: [1385, 870], name: 'ALU control' },
  regDst: { box: { x: 1480, y: 925, w: 36, h: 110 }, pin: [1498, 927], name: 'RegDst mux' },
  fu: { box: { x: 1150, y: 1065, w: 280, h: 100 }, pin: [1290, 1080], name: 'Forwarding unit' },
  exmem: { box: { x: 1540, y: 310, w: 40, h: BOTTOM - 310 }, pin: [1560, 340], name: 'EX/MEM' },
  dmem: { box: { x: 1690, y: 560, w: 170, h: 310 }, pin: [1775, 562], name: 'Data memory' },
  memwb: { box: { x: 1900, y: 350, w: 40, h: BOTTOM - 350 }, pin: [1920, 380], name: 'MEM/WB' },
  wbMux: { box: { x: 1990, y: 622, w: 40, h: 306 }, pin: [2010, 624], name: 'MemtoReg mux' },
}

/** The x shift PipelineDatapath applies for branch hardware (identity without it). */
export function warp(hw: Hardware) {
  const DX = hw.branch === 'id' ? 480 : hw.branch === 'mem' ? 240 : 0
  const BREAK = hw.branch === 'id' ? 1000 : 1050
  const DX2 = hw.branch === 'mem' ? 130 : 0
  return (x: number) => x + (x >= BREAK ? DX : 0) + (x >= 1600 ? DX2 : 0)
}

export function unitBox(u: Unit, hw: Hardware = {}): Box {
  const X = warp(hw)
  const b = U[u].box
  const x0 = X(b.x), x1 = X(b.x + b.w)
  return { x: x0, y: b.y, w: x1 - x0, h: b.h }
}
export function unitPin(u: Unit, hw: Hardware = {}): [number, number] {
  const [x, y] = U[u].pin
  return [warp(hw)(x), y]
}
export const unitName = (u: Unit) => U[u].name

/** The whole sheet without the stage banners (they move into the page's header chips). */
export function sheetBox(hw: Hardware = {}, banners = true): Box {
  const LEFT = hw.branch ? 210 : 0
  const TOP = hw.branch ? 150 : 0
  const w = 2100 + (hw.branch === 'id' ? 480 : hw.branch === 'mem' ? 370 : 0) + LEFT
  const top = banners ? -TOP : -TOP + 86
  return { x: -LEFT, y: top, w, h: 1280 - top }
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Grows a box by `pad` of its size on every side, then keeps it inside `limit`. */
export function pad(b: Box, padBy: number, limit: Box): Box {
  const px = b.w * padBy, py = b.h * padBy
  const x0 = Math.max(limit.x, b.x - px), y0 = Math.max(limit.y, b.y - py)
  const x1 = Math.min(limit.x + limit.w, b.x + b.w + px), y1 = Math.min(limit.y + limit.h, b.y + b.h + py)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Units a reader can click to inspect. */
export const INSPECTABLE: Unit[] = ['ifid', 'idex', 'exmem', 'memwb', 'regs', 'dmem', 'hdu', 'fu', 'control', 'aluCtl']
