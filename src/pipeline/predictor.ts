// Dynamic branch prediction, Chapter 4 Part 2 slides 82–85.
//  - Branch history table (slide 82): indexed by the low bits of the branch address.
//  - 1-bit predictor (slide 83): remembers the last outcome.
//  - 2-bit predictor (slide 84): changes its prediction only after two mispredictions in a row
//    (states 3 = strongly taken, 2 = weakly taken, 1 = weakly not taken, 0 = strongly not taken).
//  - Branch target buffer (slide 85): the target of a taken branch, looked up by PC in IF.

export type Scheme = '1bit' | '2bit'
/** One execution of a branch. */
export type BranchEvent = { pc: number; name: string; taken: boolean; where: string }

export const TABLE_SIZE = 8
export const indexOf = (pc: number) => (pc >>> 2) % TABLE_SIZE

export const predictsTaken = (s: Scheme, state: number) => (s === '1bit' ? state === 1 : state >= 2)
export const nextState = (s: Scheme, state: number, taken: boolean) => (s === '1bit' ? +taken : taken ? Math.min(3, state + 1) : Math.max(0, state - 1))
export const STATE_NAMES: Record<Scheme, string[]> = {
  '1bit': ['predict not taken', 'predict taken'],
  '2bit': ['strongly not taken', 'weakly not taken', 'weakly taken', 'strongly taken'],
}

/** The nested loop of slide 83: the inner beq at 16 jumps back to 8, the outer beq at 28 back to 0. */
export const INNER_PC = 16
export const OUTER_PC = 28
export function nestedLoop(inner: number, outer: number): BranchEvent[] {
  const out: BranchEvent[] = []
  for (let o = 1; o <= outer; o++) {
    for (let i = 1; i <= inner; i++) out.push({ pc: INNER_PC, name: 'inner', taken: i < inner, where: `outer pass ${o}, inner iteration ${i} of ${inner}` })
    out.push({ pc: OUTER_PC, name: 'outer', taken: o < outer, where: `end of outer pass ${o} of ${outer}` })
  }
  return out
}

/** "T T N T" (or 1/0) for one branch at address 16. */
export function parseOutcomes(text: string): BranchEvent[] {
  const tokens = text.toUpperCase().split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) throw new Error('Type at least one outcome, e.g. T T N T.')
  if (tokens.length > 64) throw new Error('Use at most 64 outcomes.')
  return tokens.map((t, k) => {
    if (!/^(T|N|NT|1|0)$/.test(t)) throw new Error(`"${t}" is not an outcome. Use T (taken) or N (not taken).`)
    return { pc: INNER_PC, name: 'beq', taken: t === 'T' || t === '1', where: `execution ${k + 1}` }
  })
}

export type PredRow = {
  k: number
  event: BranchEvent
  index: number
  /** Entry state before and after this branch. */
  state: number
  next: number
  predict: boolean
  correct: boolean
  /** Whether the branch target buffer already held this branch when it was fetched. */
  btbHit: boolean
}

/** Runs one predictor over the events. Every table entry starts in `init`. */
export function runPredictor(scheme: Scheme, events: BranchEvent[], init: number): { rows: PredRow[]; table: number[][] } {
  const table = Array<number>(TABLE_SIZE).fill(init)
  const btb = new Set<number>()
  const tables: number[][] = [[...table]]
  const rows = events.map((event, k) => {
    const index = indexOf(event.pc)
    const state = table[index]
    const predict = predictsTaken(scheme, state)
    const next = nextState(scheme, state, event.taken)
    const btbHit = btb.has(event.pc)
    table[index] = next
    if (event.taken) btb.add(event.pc)
    tables.push([...table])
    return { k, event, index, state, next, predict, correct: predict === event.taken, btbHit }
  })
  return { rows, table: tables }
}

/** Cycles lost per branch. The outcome is known `penalty` cycles after the fetch (1 = decided in ID,
 *  3 = decided in MEM, more in a deeper pipeline); the target is known 1 cycle after the fetch (adder in
 *  ID), or right away from the BTB. */
export const cost = {
  /** Slide 29: always fetch the fall-through. */
  staticNotTaken: (r: PredRow, penalty: number) => (r.event.taken ? penalty : 0),
  /** Prediction without a BTB: following "taken" must wait for the target from ID, so it still costs 1 cycle (slide 85). */
  noBtb: (r: PredRow, penalty: number) => guess(r.predict, r.event.taken, penalty, 1),
  /** With a BTB: a branch predicted taken and found in the BTB fetches its target in the next cycle. */
  withBtb: (r: PredRow, penalty: number) => guess(r.predict, r.event.taken, penalty, r.btbHit ? 0 : 1),
}
/** Lost cycles when the fetch follows `predict`, the target is known after `redirect` cycles and the outcome after `penalty`. */
function guess(predict: boolean, taken: boolean, penalty: number, redirect: number) {
  if (!predict) return taken ? penalty : 0
  // Following "taken" is only possible once the target is known; if the outcome is known as early, just use it.
  if (redirect >= penalty) return taken ? penalty : 0
  return taken ? redirect : penalty
}
