// The parts of the studio that only the Control hazards lab has: the hardware grid (in the plan and in
// the Hardware pill's popover) and the list of branch executions.

import { branchRuns, regName, type BranchAt, type Hardware, type Policy, type Simulation } from '../pipeline/engine'
import { Chip, ordinal, POLICY, WHERE } from './PipelineLab'

export type HwTotal = { hw: Hardware; cycles: number | string }

export const hwLabel = (hw: Hardware) => `${WHERE[hw.branch ?? 'id'].label} · ${POLICY[hw.policy ?? 'predict'].label}`

const ROWS: BranchAt[] = ['mem', 'id']
const COLS: Policy[] = ['stall', 'predict', 'delayed']
const DELAYED_NOTE = '* A delayed branch changes what the program does (the delay slot always runs), so compare it only on programs written for it.'

/** Every hardware choice as a radio cell: the program's total cycles and how far it is from the fewest. */
export function HardwareGrid({ hw, totals, onPick }: { hw: Hardware; totals: HwTotal[]; onPick: (h: Hardware) => void }) {
  const fewest = Math.min(...totals.flatMap((t) => (typeof t.cycles === 'number' ? [t.cycles] : [])))
  return <>
    <div className="st-hw-grid" role="radiogroup" aria-label="Hardware">
      <span />
      {COLS.map((p) => <span key={p} className="st-hw-head">{POLICY[p].label}<small>{POLICY[p].slide}</small></span>)}
      {ROWS.map((b) => [
        <span key={b} className="st-hw-head row">Decided in {WHERE[b].label}<small>{WHERE[b].slide}</small></span>,
        ...COLS.map((p) => {
          if (b === 'mem' && p === 'delayed') return <span key={p} className="st-hw-na">Only with the branch decided in ID</span>
          const t = totals.find((x) => x.hw.branch === b && x.hw.policy === p)
          const on = hw.branch === b && hw.policy === p
          const n = t?.cycles ?? '—'
          const diff = typeof n !== 'number' ? 'does not run' : n === fewest ? 'fewest' : `+${n - fewest}`
          return <button key={p} role="radio" aria-checked={on} className="st-hw-cell" onClick={() => onPick({ branch: b, policy: p })}
            aria-label={`Decided in ${WHERE[b].label}, ${POLICY[p].label}: ${n} cycles, ${diff}`}>
            <b>{n}{p === 'delayed' && <sup>*</sup>}</b><span>cycles · {diff}{on ? ' · selected' : ''}</span>
          </button>
        }),
      ])}
    </div>
    <p className="st-hw-note">{DELAYED_NOTE}</p>
  </>
}

/** One row per branch execution: when it was decided, what it compared, and what it cost. */
export function BranchRuns({ sim }: { sim: Simulation }) {
  const runs = branchRuns(sim)
  const hw = sim.hw
  const taken = runs.filter((r) => r.taken).length
  return <div className="st-runs">
    <div className="st-plan-head">
      <h2>Branches in this program</h2>
      <span>{runs.length ? `${taken} of ${runs.length} branch${runs.length > 1 ? 'es' : ''} taken · ` : ''}decided in {WHERE[hw.branch!].label}, {POLICY[hw.policy!].label.toLowerCase()}</span>
    </div>
    {runs.length ? <ul>{runs.map((r) => {
      const repeats = runs.filter((x) => x.instr.id === r.instr.id).length > 1
      // Which compared registers the branch waited for (for "operand" or "operands").
      const waited = new Set<number>()
      for (const c of sim.cycles) {
        const h = c.hazard.branch
        if (c.at.ifid?.seq !== r.seq || !c.hazard.stall || !h) continue
        if (h.aluRs || h.loadRs) waited.add(r.instr.rs)
        if (h.aluRt || h.loadRt) waited.add(r.instr.rt)
      }
      return <li key={r.seq}>
        <span className="st-runs-who"><Chip i={r.instr} /><span>{repeats ? <><b>{ordinal(r.nth + 1)} time</b> · </> : null}cycle {r.cycle}</span></span>
        <span className="st-runs-what">
          {hw.branch === 'id' && <code>{r.instr.rt === 0 ? `${regName(r.instr.rs)} = ${r.a} ${r.a === r.b ? '=' : '≠'} 0` : `${regName(r.instr.rs)} = ${r.a}, ${regName(r.instr.rt)} = ${r.b}`}</code>}
          <span className={`pl-tag ${r.taken ? 'branch' : 'muted'}`}>{r.taken ? `taken → ${r.target}` : 'not taken'}</span>
          {r.lost ? <span className="pl-tag flush">{r.lost} slot{r.lost > 1 ? 's' : ''} thrown away</span> : <span className="pl-tag muted">no cycle lost</span>}
          {r.dataStalls ? <span className="pl-tag hazard">{r.dataStalls} stall{r.dataStalls > 1 ? 's' : ''} for its operand{waited.size > 1 ? 's' : ''}</span> : null}
          {r.forwarded.length ? <span className="pl-tag ex">{r.forwarded.map((f) => regName(f === 'Rs' ? r.instr.rs : r.instr.rt)).join(', ')} forwarded from EX/MEM · slide 79</span> : null}
        </span>
      </li>
    })}</ul> : <p className="muted">No branch was executed.</p>}
  </div>
}
