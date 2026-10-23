import { useEffect, useMemo, useState } from 'react'
import { cost, indexOf, INNER_PC, nestedLoop, OUTER_PC, parseOutcomes, runPredictor, STATE_NAMES, TABLE_SIZE, type BranchEvent, type PredRow, type Scheme } from '../pipeline/predictor'
import './pipeline.css'

// Slides 82–85: dynamic prediction with a branch history table, the 1-bit predictor's
// shortcoming on nested loops, the 2-bit predictor, and the branch target buffer.

const GREEN = 'var(--branch)', RED = 'var(--hazard)', INK = 'var(--ink-strong)', MUTED = 'var(--gray-400)', CTRL = 'var(--wire-ctrl)'

/** The state machines of slides 83–84, drawn as on slide 84 (strong states on the left). */
function StateDiagram({ scheme, state, from, taken }: { scheme: Scheme; state: number; from: number | null; taken: boolean | null }) {
  const pos2: Record<number, [number, number]> = { 3: [110, 60], 2: [370, 60], 1: [370, 210], 0: [110, 210] }
  const pos1: Record<number, [number, number]> = { 1: [110, 60], 0: [110, 210] }
  const pos = scheme === '2bit' ? pos2 : pos1
  const n = scheme === '2bit' ? 4 : 2
  const fill = (s: number) => (s === state ? (s >= n / 2 ? 'var(--predict-taken-bg)' : 'var(--predict-wrong-bg)') : 'var(--gray-50)')
  // Transitions: [from, to, outcome, path, label position]
  type Tr = { a: number; b: number; t: boolean; d: string; lx: number; ly: number }
  const T2: Tr[] = [
    { a: 3, b: 3, t: true, d: 'M70,30 C60,-14 160,-14 150,30', lx: 110, ly: -14 },
    { a: 3, b: 2, t: false, d: 'M200,48 L280,48', lx: 236, ly: 38 },
    { a: 2, b: 3, t: true, d: 'M280,72 L200,72', lx: 240, ly: 90 },
    { a: 2, b: 1, t: false, d: 'M355,92 L355,178', lx: 316, ly: 140 },
    { a: 1, b: 2, t: true, d: 'M385,178 L385,92', lx: 410, ly: 140 },
    { a: 1, b: 0, t: false, d: 'M280,198 L200,198', lx: 240, ly: 190 },
    { a: 0, b: 1, t: true, d: 'M200,222 L280,222', lx: 240, ly: 240 },
    { a: 0, b: 0, t: false, d: 'M70,240 C60,284 160,284 150,240', lx: 110, ly: 298 },
  ]
  const T1: Tr[] = [
    { a: 1, b: 1, t: true, d: 'M200,48 C250,30 250,80 200,72', lx: 268, ly: 64 },
    { a: 1, b: 0, t: false, d: 'M95,92 L95,178', lx: 56, ly: 140 },
    { a: 0, b: 1, t: true, d: 'M125,178 L125,92', lx: 150, ly: 140 },
    { a: 0, b: 0, t: false, d: 'M200,198 C250,180 250,230 200,222', lx: 268, ly: 214 },
  ]
  const trs = scheme === '2bit' ? T2 : T1
  const w = scheme === '2bit' ? 480 : 300
  return <svg viewBox={`0 -32 ${w} 340`} className={`bp-fsm s-${scheme}`} role="img" aria-label={`${scheme === '2bit' ? '2-bit' : '1-bit'} predictor state machine, now in state ${STATE_NAMES[scheme][state]}`}>
    <defs>
      {[['n', CTRL], ['g', GREEN], ['r', RED]].map(([k, c]) => <marker key={k} id={`bp-${scheme}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>)}
    </defs>
    {trs.map((t, i) => {
      const hot = from === t.a && taken === t.t
      const c = hot ? (t.t ? GREEN : RED) : CTRL
      return <g key={i}>
        <path d={t.d} fill="none" stroke={c} strokeWidth={hot ? 4 : 1.6} markerEnd={`url(#bp-${scheme}-${hot ? (t.t ? 'g' : 'r') : 'n'})`} />
        <text x={t.lx} y={t.ly} textAnchor="middle" fontSize={13} fill={hot ? c : 'var(--gray-700)'} fontWeight={hot ? 700 : 400}>{t.t ? 'Taken' : 'Not taken'}</text>
      </g>
    })}
    {Object.entries(pos).map(([s, [cx, cy]]) => {
      const k = Number(s)
      const on = k === state
      return <g key={s}>
        <ellipse cx={cx} cy={cy} rx={90} ry={32} fill={fill(k)} stroke={on ? INK : MUTED} strokeWidth={on ? 3.5 : 1.5} />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={14} fontWeight={700} fill={on ? INK : 'var(--gray-700)'}>{k >= n / 2 ? 'Predict taken' : 'Predict not taken'}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize={12} fill="var(--gray-700)">{scheme === '2bit' ? `${['strong', 'weak', 'weak', 'strong'][k]} · ${k.toString(2).padStart(2, '0')}` : `bit = ${k}`}</text>
      </g>
    })}
  </svg>
}

function PredictorCard({ scheme, rows, tables, step, init }: { scheme: Scheme; rows: PredRow[]; tables: number[][]; step: number; init: number }) {
  const r = step > 0 ? rows[step - 1] : null
  const table = tables[step]
  const wrong = rows.slice(0, step).filter((x) => !x.correct).length
  const shown = r ? r.next : init
  return <article className="bp-card">
    <header>
      <h2>{scheme === '1bit' ? '1-bit predictor' : '2-bit predictor'}</h2>
      <span className="muted">{scheme === '1bit' ? 'slide 83: remembers the last outcome' : 'slide 84: changes only after two misses in a row'}</span>
    </header>
    <StateDiagram scheme={scheme} state={shown} from={r ? r.state : null} taken={r ? r.event.taken : null} />
    {r ? <p className={`bp-verdict ${r.correct ? 'ok' : 'bad'}`}>
      Entry {r.index} was <b>{STATE_NAMES[scheme][r.state]}</b> → predicted <b>{r.predict ? 'taken' : 'not taken'}</b>; the branch was <b>{r.event.taken ? 'taken' : 'not taken'}</b>: {r.correct ? '✔ correct.' : '✘ mispredicted: flush and fetch the other path.'}{' '}
      {r.state === r.next ? 'The entry stays.' : <>The entry becomes <b>{STATE_NAMES[scheme][r.next]}</b>.</>}
    </p> : <p className="bp-verdict">Every entry starts as <b>{STATE_NAMES[scheme][init]}</b>.</p>}
    <table className="bp-bht">
      <caption>Branch history table (index = PC bits 4–2)</caption>
      <thead><tr>{table.map((_, i) => <th key={i} className={r?.index === i ? 'on' : ''}>{i}</th>)}</tr></thead>
      <tbody><tr>{table.map((s, i) => <td key={i} className={`${r?.index === i ? 'on' : ''} ${(scheme === '1bit' ? s === 1 : s >= 2) ? 't' : 'n'}`}>{scheme === '1bit' ? s : s.toString(2).padStart(2, '0')}</td>)}</tr></tbody>
    </table>
    <p className="bp-score"><b>{step - wrong}</b> of {step} correct{step ? ` (${Math.round(((step - wrong) / step) * 100)}%)` : ''} · <b className={wrong ? 'bad' : ''}>{wrong}</b> misprediction{wrong === 1 ? '' : 's'}</p>
  </article>
}

export function BranchPrediction() {
  const [mode, setMode] = useState<'nested' | 'custom'>('nested')
  const [inner, setInner] = useState(4)
  const [outer, setOuter] = useState(3)
  const [custom, setCustom] = useState('T T N T')
  const [init2, setInit2] = useState(3)
  const [init1, setInit1] = useState(1)
  const [penalty, setPenalty] = useState(3)
  const [step, setStep] = useState(0)

  const { events, error } = useMemo((): { events: BranchEvent[]; error: string } => {
    try { return { events: mode === 'nested' ? nestedLoop(inner, outer) : parseOutcomes(custom), error: '' } } catch (e) { return { events: [], error: (e as Error).message } }
  }, [mode, inner, outer, custom])
  const one = useMemo(() => runPredictor('1bit', events, init1), [events, init1])
  const two = useMemo(() => runPredictor('2bit', events, init2), [events, init2])
  const last = events.length
  const k = Math.min(step, last)
  const go = (n: number) => setStep(Math.max(0, Math.min(last, n)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, select, input')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); go(k + 1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(k - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const ev = k > 0 ? events[k - 1] : null
  const upTo = (rows: PredRow[], f: (r: PredRow, p: number) => number, all = false) => rows.slice(0, all ? rows.length : k).reduce((s, r) => s + f(r, penalty), 0)
  const schemes: { name: string; slide: string; rows: PredRow[]; f: (r: PredRow, p: number) => number }[] = [
    { name: 'Predict not taken (static)', slide: 'slide 29', rows: one.rows, f: cost.staticNotTaken },
    { name: '1-bit, no BTB', slide: 'slides 83, 85', rows: one.rows, f: cost.noBtb },
    { name: '2-bit, no BTB', slide: 'slides 84, 85', rows: two.rows, f: cost.noBtb },
    { name: '1-bit + BTB', slide: 'slides 83, 85', rows: one.rows, f: cost.withBtb },
    { name: '2-bit + BTB', slide: 'slides 84, 85', rows: two.rows, f: cost.withBtb },
  ]
  const btb = [...new Set(events.slice(0, k).filter((e) => e.taken).map((e) => e.pc))]
  const target = (pc: number) => (pc === INNER_PC ? 8 : pc === OUTER_PC ? 0 : 8)

  return <main className="page pipeline-lab bp">
    <header className="pl-hero">
      <p className="crumb">Chapter 4 Part 2 · slides 82–85</p>
      <h1>Branch prediction: 1-bit, 2-bit and the branch target buffer</h1>
    </header>

    <section className="pl-overview bp-intro">
      <p className="pl-goal"><b>Dynamic branch prediction (slide 82).</b> In deeper and superscalar pipelines a branch is decided many cycles after it is fetched, so guessing well matters. A <b>branch history table</b>, indexed by the low bits of the branch address, stores what each branch did recently. To execute a branch: check the table, expect the same outcome, start fetching from the fall-through or the target. If wrong, flush the pipeline and update the entry.</p>
      <div className="bp-controls">
        <div role="radiogroup" aria-label="Branch outcomes">
          <span className="pl-hw-label">Outcomes</span>
          <button role="radio" aria-checked={mode === 'nested'} onClick={() => { setMode('nested'); setStep(0) }}><b>Nested loop</b><small>slide 83</small></button>
          <button role="radio" aria-checked={mode === 'custom'} onClick={() => { setMode('custom'); setStep(0) }}><b>Your own sequence</b><small>T / N</small></button>
        </div>
        {mode === 'nested' ? <div className="bp-fields">
          <label>Inner iterations <input type="number" min={2} max={10} value={inner} onChange={(e) => { setInner(Math.max(2, Math.min(10, Number(e.target.value) || 2))); setStep(0) }} /></label>
          <label>Outer iterations <input type="number" min={1} max={4} value={outer} onChange={(e) => { setOuter(Math.max(1, Math.min(4, Number(e.target.value) || 1))); setStep(0) }} /></label>
        </div> : <div className="bp-fields">
          <label>Outcomes of one beq <input type="text" value={custom} spellCheck={false} onChange={(e) => { setCustom(e.target.value); setStep(0) }} /></label>
        </div>}
        <div className="bp-fields">
          <label>1-bit starts <select value={init1} onChange={(e) => { setInit1(Number(e.target.value)); setStep(0) }}>{STATE_NAMES['1bit'].map((s, i) => <option key={s} value={i}>{s}</option>)}</select></label>
          <label>2-bit starts <select value={init2} onChange={(e) => { setInit2(Number(e.target.value)); setStep(0) }}>{STATE_NAMES['2bit'].map((s, i) => <option key={s} value={i}>{s}</option>)}</select></label>
          <label>Outcome known after <select value={penalty} onChange={(e) => setPenalty(Number(e.target.value))}>
            <option value={1}>1 cycle (decided in ID)</option><option value={3}>3 cycles (decided in MEM)</option><option value={10}>10 cycles (deep pipeline)</option>
          </select></label>
        </div>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {mode === 'nested' && <pre className="bp-code">{`        # nested loop of slide 83 (addresses in bytes)
 0 outer: …
 8 inner: …
          …
16        beq …, …, inner   # taken ${inner - 1}×, then falls through
          …
28        beq …, …, outer   # taken ${outer - 1}×, then falls through`}</pre>}
    </section>

    <section className="pl-sim bp-sim" aria-label="Predictor">
      <div className="pl-toolbar" role="toolbar" aria-label="Branches">
        <div className="pl-now" aria-live="polite">
          <b>Branch {k}<span className="muted"> / {last}</span></b>
          <span className="pl-now-title">{ev ? `${ev.name === 'beq' ? 'beq' : `beq ${ev.name}`} (PC ${ev.pc}) · ${ev.where} · actually ${ev.taken ? 'taken' : 'not taken'}` : 'Before the first branch'}</span>
        </div>
        <div className="pl-buttons">
          <button onClick={() => go(0)} disabled={k === 0} aria-label="Reset">⇤</button>
          <button onClick={() => go(k - 1)} disabled={k === 0}>◀ Back</button>
          <button className="lab-primary" onClick={() => go(k + 1)} disabled={k === last}>Next branch ▶</button>
          <button onClick={() => go(last)} disabled={k === last} aria-label="End">⇥</button>
        </div>
      </div>
      <div className="bp-cards">
        <PredictorCard scheme="1bit" rows={one.rows} tables={one.table} step={k} init={init1} />
        <PredictorCard scheme="2bit" rows={two.rows} tables={two.table} step={k} init={init2} />
      </div>
    </section>

    <section className="pl-panel">
      <div className="pl-head"><h2>Every branch</h2><span className="muted">Click a column to jump there. ✔ correct guess, ✘ misprediction (a flush).</span></div>
      <div className="pl-chart-scroll">
        <table className="bp-history">
          <tbody>
            <tr><th>Branch</th>{events.map((e, i) => <td key={i} className={i === k - 1 ? 'on' : i >= k ? 'future' : ''} onClick={() => go(i + 1)}>{e.name === 'beq' ? i + 1 : e.name}</td>)}</tr>
            <tr><th>Actual</th>{events.map((e, i) => <td key={i} className={`${i === k - 1 ? 'on' : i >= k ? 'future' : ''} ${e.taken ? 't' : 'n'}`} onClick={() => go(i + 1)}>{e.taken ? 'T' : 'N'}</td>)}</tr>
            {[['1-bit', one.rows], ['2-bit', two.rows]].map(([name, rows]) => <tr key={name as string}><th>{name as string}</th>{(rows as PredRow[]).map((r, i) => <td key={i} className={`${i === k - 1 ? 'on' : i >= k ? 'future' : ''} ${r.correct ? 'ok' : 'bad'}`} onClick={() => go(i + 1)}>{r.predict ? 'T' : 'N'} {r.correct ? '✔' : '✘'}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      {mode === 'nested' && <p className="muted pl-note">Slide 83: with 1 bit the inner beq is mispredicted twice per pass: as taken on its last iteration, then as not taken on the first iteration of the next pass. With 2 bits only the exit is missed (after the first pass).</p>}
    </section>

    <section className="pl-panel eqs pl-rules">
      <div>
        <h3>Cycles lost so far (and in total) · slides 29, 83–85</h3>
        <table className="pl-compare bp-cost">
          <thead><tr><th>Scheme</th><th>Mispredictions</th><th>Cycles lost so far</th><th>In total</th></tr></thead>
          <tbody>{schemes.map((s) => <tr key={s.name}>
            <td>{s.name} <span className="muted">· {s.slide}</span></td>
            <td>{s.f === cost.staticNotTaken ? events.slice(0, k).filter((e) => e.taken).length : s.rows.slice(0, k).filter((r) => !r.correct).length}</td>
            <td><b>{upTo(s.rows, s.f)}</b></td><td>{upTo(s.rows, s.f, true)}</td>
          </tr>)}</tbody>
        </table>
        <p className="muted pl-note">A wrong guess costs {penalty} cycle{penalty > 1 ? 's' : ''} (the outcome is known {penalty} cycle{penalty > 1 ? 's' : ''} after the fetch). Without a BTB, following a “taken” prediction must wait for the target adder in ID, so even a correctly predicted taken branch costs 1 cycle (slide 85).{penalty === 1 ? ' With the branch decided in ID the outcome is known as early as the target, so prediction without a BTB cannot beat predict not taken: that is why the 5-stage MIPS just predicts not taken (slide 28).' : ''}</p>
      </div>
      <div>
        <h3>Branch target buffer · slide 85</h3>
        <ul className="plain-steps">
          <li>A cache of target addresses, looked up with the PC while the instruction is fetched.</li>
          <li>Hit, and the predictor says taken: fetch the target in the very next cycle. No cycle lost.</li>
          <li>Miss: the instruction is fetched as usual; a taken branch is entered into the BTB when it is decided.</li>
        </ul>
        <table className="pl-compare">
          <thead><tr><th>PC (tag)</th><th>Target</th></tr></thead>
          <tbody>{btb.length ? btb.map((pc) => <tr key={pc} className={ev?.pc === pc ? 'on' : ''}><td className="mono">{pc}</td><td className="mono">{target(pc)}</td></tr>) : <tr><td colSpan={2} className="muted">empty</td></tr>}</tbody>
        </table>
        {ev && <p className="pl-note">This fetch of PC {ev.pc}: <b>{one.rows[k - 1].btbHit ? 'BTB hit' : 'BTB miss'}</b>{one.rows[k - 1].btbHit ? '' : ev.taken ? ', so the target is entered now that the branch was taken' : ''}.</p>}
        <p className="muted pl-note">Table index for PC {INNER_PC} is {indexOf(INNER_PC)}, for PC {OUTER_PC} is {indexOf(OUTER_PC)}; the table has {TABLE_SIZE} entries.</p>
      </div>
    </section>
  </main>
}
