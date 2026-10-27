// The home page (#/ and unknown routes), built from the design canvas's "READY · Home page" board
// (Direction B). Its motion is CSS only (home.css): scroll-driven animations where the browser has
// them, the finished static page everywhere else and with reduced motion.

import { useEffect, type CSSProperties } from 'react'
import { sheetBox, unitPin, type Unit } from '../pipeline/units'
import preview from './preview-cycle5.png'
import './home.css'

/** Where "Read the textbook" points is not decided yet (hand-off section 7): until then the card shows without its button. */
const TEXTBOOK_URL: string | null = null

type Block = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB' | 'stall'

/** The hero figure: [stage, drop order along the diagonal] per row, and how many slots the row starts in. */
const HERO: { offset: 0 | 1 | 2 | 4; blocks: [Block, number][] }[] = [
  { offset: 0, blocks: [['IF', 0], ['ID', 1], ['EX', 2], ['MEM', 3], ['WB', 4]] },
  { offset: 1, blocks: [['IF', 2], ['ID', 3], ['stall', 4], ['EX', 5], ['MEM', 6], ['WB', 7]] },
  { offset: 2, blocks: [['IF', 4], ['stall', 5], ['ID', 6], ['EX', 7], ['MEM', 8], ['WB', 9]] },
  { offset: 4, blocks: [['IF', 7], ['ID', 8], ['EX', 9], ['MEM', 10], ['WB', 11]] },
]

/** The pinned "Scroll to clock the pipeline" chart: the stage each instruction is in, by cycle. */
const CLOCK_CYCLES = 9
const CLOCK: { asm: string; cells: Record<number, Block> }[] = [
  { asm: 'lw  $t1, 0($t0)', cells: { 1: 'IF', 2: 'ID', 3: 'EX', 4: 'MEM', 5: 'WB' } },
  { asm: 'add $t3, $t1, $t2', cells: { 2: 'IF', 3: 'ID', 4: 'stall', 5: 'EX', 6: 'MEM', 7: 'WB' } },
  { asm: 'sub $t4, $t3, $t5', cells: { 3: 'IF', 4: 'stall', 5: 'ID', 6: 'EX', 7: 'MEM', 8: 'WB' } },
  { asm: 'sw  $t4, 8($t0)', cells: { 5: 'IF', 6: 'ID', 7: 'EX', 8: 'MEM', 9: 'WB' } },
]
const cycles = Array.from({ length: CLOCK_CYCLES }, (_, k) => k + 1)

const LESSONS: [string, string][] = [
  ['pc-update', 'Next PC'], ['datapath', 'Datapath walk'], ['add-bne', '+ bne'], ['add-jr', '+ jr'],
  ['add-jal', '+ jal'], ['add-lui', '+ lui'], ['add-ori', '+ ori'], ['slt', 'slt'],
]

/** The preview screenshot is the studio's whole sheet, so a unit's pin is its sheet position as a percentage. */
const SHEET = sheetBox({}, false)
function pinAt(u: Unit): CSSProperties {
  const [x, y] = unitPin(u)
  return { left: `${((x - SHEET.x) / SHEET.w) * 100}%`, top: `${((y - SHEET.y) / SHEET.h) * 100}%` }
}

const vars = (v: Record<string, number>) => v as CSSProperties

export function Home() {
  // Opened at an in-page address (#/ is the page, #labs a section): jump to the section once it exists.
  useEffect(() => {
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
  }, [])

  return <div className="home">
    {/* ---------- nav (sticky, frosts on scroll) ---------- */}
    <header className="navbar">
      <div className="hm-wrap hm-nav">
        <a className="hm-brand" href="#/"><span aria-hidden="true"><i /><i /><i /></span>CSE 209 Lab</a>
        <nav className="hm-links" aria-label="Main">
          <a className="navl" href="#labs">Labs</a>
          <a className="navl" href="#clock">How it works</a>
          <a className="navl" href="#simulator">Simulator</a>
          <a className="navl" href="#material">Textbook</a>
          <a className="btn hm-dark" href="#/data-hazards">Open simulator</a>
        </nav>
      </div>
    </header>

    {/* ---------- hero ---------- */}
    <section className="hm-wrap hm-hero">
      <div className="hero-text-wrap">
        <h1 className="hero-h">See your code move through the CPU.</h1>
        <p className="hero-p hm-soft">A hands-on lab for the MIPS processor: the single-cycle datapath, the five-stage pipeline, data and control hazards, and branch prediction.</p>
        <div className="hero-cta">
          <a className="btn hm-dark hm-big" href="#/pc-update">Start the lab</a>
          <a className="btn hm-outline hm-big" href="#clock">See how it works ↓</a>
        </div>
      </div>
      <div className="hero-fig-wrap">
        <figure className="fig" aria-label="Pipeline diagram: four instructions overlapping, with one stall">
          {HERO.map((row, r) => <div key={r} className={row.offset ? `o${row.offset}` : undefined}>
            {row.blocks.map(([s, i]) => <span key={i} className={`pl s${s === 'stall' ? 'ST' : s}`} style={vars({ '--i': i })}>{s}</span>)}
          </div>)}
          <figcaption className="hm-soft">lw, add, sub, sw — add waits one cycle for the value lw is still loading.</figcaption>
        </figure>
      </div>
    </section>

    {/* ---------- labs ---------- */}
    <section id="labs" className="hm-wrap hm-labs">
      <div className="hm-head">
        <h2 className="hm-h2 rise">Five labs, in the order you learn them.</h2>
        <p className="hm-lead hm-soft rise">Start with one instruction in the single-cycle datapath. Finish with how a pipelined CPU guesses a branch.</p>
      </div>
      <div className="hm-grid">
        <div className="wide reveal" style={vars({ '--d': 0 })}>
          <div className="tile t-single">
            <div className="t-flow" aria-hidden="true">
              <span className="chip c-line">PC</span><span>→</span><span className="chip c-line">IM</span><span>→</span><span className="chip c-line">Reg</span><span>→</span><span className="chip c-ink">ALU</span><span>→</span><span className="chip c-line">DM</span>
            </div>
            <div className="t-foot">
              <div className="t-text">
                <span>Chapter 4 · Part 1 · 8 lessons</span>
                <h3><a href="#/pc-update">Single-cycle datapath</a></h3>
                <p>Choose the next PC, walk one instruction through the datapath and its control signals, then add new instructions to the hardware.</p>
              </div>
              <nav className="t-lessons" aria-label="Single-cycle lessons">
                {LESSONS.map(([path, title]) => <a key={path} className="lesson" href={`#/${path}`}>{title}</a>)}
              </nav>
            </div>
          </div>
        </div>

        <div className="reveal" style={vars({ '--d': 1 })}>
          <a className="tile t-fwd" href="#/forwarding">
            <div className="t-blocks" aria-hidden="true">
              {[4, 3, 2].map((on) => <div key={on}>{[0, 1, 2, 3, 4].map((k) => <span key={k} className={k === on ? 'on' : undefined} />)}</div>)}
            </div>
            <div className="t-text">
              <span>Chapter 4 · Part 2 · slides 12–24, 53–76</span>
              <h3>Forwarding</h3>
              <p>Type MIPS code or pick a preset, switch forwarding on and off, and see every dependence, stall and the total cycles.</p>
            </div>
          </a>
        </div>

        <div className="reveal" style={vars({ '--d': 0 })}>
          <a className="tile t-data" href="#/data-hazards">
            <div className="t-rows" aria-hidden="true">
              <div><span className="chip c-line">lw $2</span><span className="chip c-ink">MEM</span></div>
              <div><span className="chip c-line">and $4, $2</span><span className="chip c-dash">stall</span></div>
            </div>
            <div className="t-text">
              <span>Chapter 4 · Part 2 · slides 52–75</span>
              <h3>Data hazards</h3>
              <p>Clock a program through the five-stage datapath and watch forwarding, hazard detection and stalls, cycle by cycle.</p>
            </div>
          </a>
        </div>

        <div className="reveal" style={vars({ '--d': 1 })}>
          <a className="tile t-ctrl" href="#/control-hazards">
            <div className="t-rows" aria-hidden="true">
              <div><span className="chip c-ink">beq taken</span><span className="chip c-line">→ PC</span></div>
              <div><span className="chip c-dash c-struck">I2</span><span className="chip c-dash c-struck">I3</span><span className="chip c-dash c-struck">I4</span></div>
            </div>
            <div className="t-text">
              <span>Chapter 4 · Part 2 · slides 25–31, 77–81</span>
              <h3>Control hazards</h3>
              <p>Decide branches in MEM or ID, then predict not taken, stall or use a delay slot, and compare what each one costs.</p>
            </div>
          </a>
        </div>

        <div className="reveal" style={vars({ '--d': 2 })}>
          <a className="tile t-pred" href="#/branch-prediction">
            <div className="t-states" aria-hidden="true">
              <b className="on">11</b><span>⇄</span><b>10</b><span>⇄</span><b>01</b><span>⇄</span><b>00</b>
            </div>
            <div className="t-text">
              <span>Chapter 4 · Part 2 · slides 82–85</span>
              <h3>Branch prediction</h3>
              <p>Run 1-bit and 2-bit predictors and a branch target buffer on loops, and count the cycles each scheme loses.</p>
            </div>
          </a>
        </div>
      </div>
    </section>

    {/* ---------- scroll = clock (pinned section) ---------- */}
    <section id="clock" className="hm-wrap">
      <div className="ctrack">
        <div className="hm-clock-in">
          <div className="hm-clock-text">
            <h2 className="hm-h2">Scroll to clock the pipeline.</h2>
            <div className="hm-counter">
              <span>Cycle</span>
              <span className="hm-odo-win" aria-hidden="true">
                <span className="odo">{cycles.map((c) => <span key={c}>{c}</span>)}</span>
              </span>
            </div>
            <div className="hm-caps">
              <p className="cap cap1">Cycles 1–3: one instruction enters per cycle, and every stage works at the same time.</p>
              <p className="cap cap2">Cycle 4: <b>add</b> needs <b>$t1</b>, but <b>lw</b> is still in MEM. The hazard detection unit stalls one cycle.</p>
              <p className="cap cap3">From cycle 5: MEM/WB forwards the loaded value. Four instructions finish in 9 cycles instead of 20.</p>
            </div>
          </div>
          <div className="hm-chart">
            <div className="hm-chart-scroll">
              <div className="hm-chart-rows">
                <div className="hm-chart-row">
                  <span />
                  {cycles.map((c) => <span key={c} className="hdr" style={vars({ '--c': c })}>{c}</span>)}
                </div>
                {CLOCK.map((row) => <div key={row.asm} className="hm-chart-row">
                  <code>{row.asm}</code>
                  {cycles.map((c) => {
                    const s = row.cells[c]
                    return s ? <span key={c} className={`cell ${s === 'stall' ? 's-stall' : `s${s}`}`} style={vars({ '--c': c })}>{s}</span> : <span key={c} />
                  })}
                </div>)}
              </div>
            </div>
            <div className="hm-progress"><div className="bar" /></div>
            <div className="hm-chart-foot hm-soft"><span>4 instructions · 1 stall</span><span>9 cycles</span></div>
          </div>
        </div>
      </div>
    </section>

    {/* ---------- simulator preview: tilts flat as it enters ---------- */}
    <section id="simulator" className="hm-wrap hm-sim">
      <div className="hm-head">
        <h2 className="hm-h2 rise">Write it, run it, watch every stage.</h2>
        <a className="btn hm-dark" href="#/data-hazards">Open the simulator</a>
      </div>
      <div className="tilt">
        <div className="pv" aria-label="Preview of the Data hazards lab" role="img">
          <div className="pv-top">
            <span><b>CSE 209 Lab</b><span className="pv-section"><span style={{ color: 'var(--muted)' }}>Pipelining ›</span> <b>Data hazards</b></span></span>
            <span className="pv-example"><span style={{ color: 'var(--muted)' }}>Example</span> <b>Load-use hazard</b></span>
          </div>
          <div className="pv-body">
            <div className="pv-stage">
              <div className="pv-occ">
                <span><b>IF</b><span className="mini" style={{ background: 'var(--instr-4)' }}>I4</span></span>
                <span><b>ID</b><span className="mini" style={{ background: 'var(--instr-3)' }}>I3</span></span>
                <span className="on"><b>EX</b><span className="mini" style={{ background: 'var(--instr-2)' }}>I2</span></span>
                <span><b>MEM</b><span className="mini" style={{ background: 'var(--gray-500)' }}>bubble</span></span>
                <span><b>WB</b><span className="mini" style={{ background: 'var(--instr-1)' }}>I1</span></span>
              </div>
              <div className="pv-shot" style={{ aspectRatio: `${SHEET.w} / ${SHEET.h}` }}>
                <img src={preview} alt="" />
                <span className="pin" style={pinAt('rfWrite')}>1</span>
                <span className="pin" style={pinAt('muxA')}>2</span>
              </div>
              <div className="pv-clock">
                <span className="lbl">Cycle 5</span>
                <span>1</span><span>2</span><span className="hz">3</span><span className="hz">4</span><span className="now">5</span><span className="later">6</span><span className="later">7</span><span className="later">…</span>
                <span className="next">Next ▶</span>
              </div>
            </div>
            <div className="pv-script">
              <span className="pv-eyebrow">Cycle 5 of 10</span>
              <span className="pv-title">ForwardA = 01, and $2 is written</span>
              <div className="pv-line"><b>1</b><span><b>WB</b> · I1 writes <b className="mono">$2 ← 42</b> in the 1st half.</span></div>
              <div className="pv-line"><b>2</b><span><b>EX</b> · I2 gets $2 from MEM/WB: <b>ForwardA = 01</b>.</span></div>
              <span className="pv-tag">MEM/WB forward</span>
            </div>
          </div>
        </div>
      </div>
      <div className="hm-points">
        <div className="reveal" style={vars({ '--d': 0 })}><b>The camera follows the step</b><span className="hm-soft">The datapath zooms to the part of the hardware each step is about.</span></div>
        <div className="reveal" style={vars({ '--d': 1 })}><b>Click any unit to inspect it</b><span className="hm-soft">Pipeline registers, the register file, the forwarding unit: what each holds now and at the next edge.</span></div>
        <div className="reveal" style={vars({ '--d': 2 })}><b>Start from lecture code</b><span className="hm-soft">50 example programs from the slides, or type your own.</span></div>
      </div>
    </section>

    {/* ---------- worked example: the load moves up as you scroll ---------- */}
    <section id="example" className="hm-wrap hm-example">
      <div className="hm-head">
        <h2 className="hm-h2 rise">Move one load, save two cycles.</h2>
        <p className="hm-lead hm-soft rise">The code-scheduling example from the lectures, for <span className="mono">A = B + E; C = B + F;</span></p>
      </div>
      <div className="ex-grid">
        <div className="ex-card reveal" style={vars({ '--d': 0 })}>
          <div><b>As written</b><span className="chip ex-slow">13 cycles</span></div>
          <div className="ex-code">
            <span>lw   $t1, 0($t0)</span>
            <span>lw   $t2, 4($t0)</span>
            <span className="gone">stall — $t2 not loaded yet</span>
            <span>add  $t3, $t1, $t2</span>
            <span>sw   $t3, 12($t0)</span>
            <span>lw   $t4, 8($t0)</span>
            <span className="gone">stall — $t4 not loaded yet</span>
            <span>add  $t5, $t1, $t4</span>
            <span>sw   $t5, 16($t0)</span>
          </div>
        </div>
        <div className="ex-card reveal" style={vars({ '--d': 1 })}>
          <div><b>Scheduled</b><span className="chip ex-fast">11 cycles</span></div>
          <div className="ex-code">
            <span>lw   $t1, 0($t0)</span>
            <span>lw   $t2, 4($t0)</span>
            <span className="moved">lw   $t4, 8($t0)   ↑ moved up</span>
            <span>add  $t3, $t1, $t2</span>
            <span>sw   $t3, 12($t0)</span>
            <span>add  $t5, $t1, $t4</span>
            <span>sw   $t5, 16($t0)</span>
          </div>
        </div>
      </div>
      <div className="ex-more"><a href="#/data-hazards">Run both versions in the Data hazards lab →</a></div>
    </section>

    {/* ---------- course material: the block opens up as it arrives ---------- */}
    <section id="material" className="hm-wrap hm-material">
      <div className="grow">
        <div className="mt-text">
          <h2>Built on your CSE 209 lectures.</h2>
          <div className="mt-list">
            <div><i style={{ background: 'var(--home-sage)' }} /><span><b>The single-cycle datapath</b><small>Chapter 4 · Part 1</small></span></div>
            <div><i style={{ background: 'var(--home-tomato)' }} /><span><b>Pipelining, data and control hazards</b><small>Chapter 4 · Part 2 · slides 12–81</small></span></div>
            <div><i style={{ background: 'var(--home-mustard)' }} /><span><b>Branch prediction</b><small>Chapter 4 · Part 2 · slides 82–85</small></span></div>
          </div>
        </div>
        <div className="mt-book">
          <div>
            <span>Companion textbook</span>
            <span>MIPS, the Pipelined Processor &amp; Floating-Point Arithmetic</span>
            <span>Written for first-time learners, with solved past term-final questions for every topic.</span>
          </div>
          {TEXTBOOK_URL && <a className="btn hm-dark" href={TEXTBOOK_URL}>Read the textbook</a>}
        </div>
      </div>
    </section>

    <footer className="hm-wrap hm-foot">
      <div className="hm-soft">
        <span>CSE 209 Lab</span>
        <span>CSE 209 Computer Architecture · after Patterson &amp; Hennessy</span>
      </div>
    </footer>
  </div>
}
