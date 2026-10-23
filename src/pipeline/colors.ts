import type { Instr } from './engine'

/** One colour per instruction, used in the stage banners, pipeline registers and timing chart.
 *  Kept away from the flush pink and the hazard red, so a tinted stage never looks like a flush or a stall. */
export const PALETTE = ['#1971c2', '#2b8a3e', '#8b5a2b', '#e67700', '#6741d9', '#0c8599', '#5c940d', '#9c36b5']
export const instrColor = (i: Instr) => PALETTE[i.id % PALETTE.length]
/** Light fill of a colour (hex alpha suffix). */
export const tint = (c: string, a = '1f') => c + a
