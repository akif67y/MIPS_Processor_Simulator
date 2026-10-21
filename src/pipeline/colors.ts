import type { Instr } from './engine'

/** One colour per instruction, used in the stage banners, pipeline registers and timing chart. */
export const PALETTE = ['#1971c2', '#2b8a3e', '#c2255c', '#e67700', '#6741d9', '#0c8599', '#5c940d', '#a61e4d']
export const instrColor = (i: Instr) => PALETTE[i.id % PALETTE.length]
/** Light fill of a colour (hex alpha suffix). */
export const tint = (c: string, a = '1f') => c + a
