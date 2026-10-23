import type { Instr } from './engine'

/** One colour per instruction, used in the stage banners, pipeline registers and timing chart.
 *  Kept away from the flush pink and the hazard red, so a tinted stage never looks like a flush or a stall.
 *  The values are --instr-1 … --instr-8 in src/tokens.css. */
export const PALETTE = Array.from({ length: 8 }, (_, k) => `var(--instr-${k + 1})`)
export const instrColor = (i: Instr) => PALETTE[i.id % PALETTE.length]
/** Light fill of a colour; `a` is the opacity as a two-digit hex alpha. */
export const tint = (c: string, a = '1f') => `color-mix(in srgb, ${c} ${(parseInt(a, 16) / 2.55).toFixed(3)}%, transparent)`
