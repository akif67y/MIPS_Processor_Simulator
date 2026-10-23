import { useMemo, useState } from 'react'

// ---------- parsing a tiny MIPS subset ----------
type Field = 'Rs' | 'Rt'
type Src = { reg: string; field: Field }
type Ins = { text: string; kind: 'alu' | 'lw' | 'sw' | 'br'; dest?: string; srcs: Src[] }

const R3 = ['add', 'sub', 'and', 'or', 'slt', 'nor', 'addu', 'subu']
const RI = ['addi', 'addiu', 'andi', 'ori', 'slti']

function reg(s: string) {
  let r = s.trim().toLowerCase()
  if (r === '$0') r = '$zero'
  if (!/^\$\w+$/.test(r)) throw new Error(`"${s.trim()}" is not a register`)
  return r
}

function parse(src: string): Ins[] {
  return src
    .split('\n')
    .map((l) => l.replace(/#.*/, '').replace(/^\s*\w+:/, '').trim()) // drop comments and labels
    .filter(Boolean)
    .map((text) => {
      const m = text.match(/^(\w+)\s+(.+)$/)
      if (!m) throw new Error(`can't read "${text}"`)
      const op = m[1].toLowerCase()
      const a = m[2].split(',').map((s) => s.trim())
      const base = () => {
        const mm = a[1]?.match(/^-?\w*\((\$\w+)\)$/)
        if (!mm) throw new Error(`"${text}": expected offset($reg)`)
        return reg(mm[1])
      }
      if (R3.includes(op)) {
        if (a.length !== 3) throw new Error(`"${text}": needs 3 registers`)
        return { text, kind: 'alu', dest: reg(a[0]), srcs: [{ reg: reg(a[1]), field: 'Rs' }, { reg: reg(a[2]), field: 'Rt' }] }
      }
      if (RI.includes(op)) return { text, kind: 'alu', dest: reg(a[0]), srcs: [{ reg: reg(a[1]), field: 'Rs' }] }
      if (op === 'lw') return { text, kind: 'lw', dest: reg(a[0]), srcs: [{ reg: base(), field: 'Rs' }] }
      if (op === 'sw') return { text, kind: 'sw', srcs: [{ reg: base(), field: 'Rs' }, { reg: reg(a[0]), field: 'Rt' }] }
      if (op === 'beq' || op === 'bne') {
        if (a.length !== 3) throw new Error(`"${text}": needs 2 registers and a label`)
        return { text, kind: 'br', srcs: [{ reg: reg(a[0]), field: 'Rs' }, { reg: reg(a[1]), field: 'Rt' }] }
      }
      throw new Error(`"${op}" isn't supported here (use add, sub, and, or, slt, addi, lw, sw, beq, bne)`)
    })
}

// ---------- timing ----------
type Via = 'exmem' | 'memwb' | 'regfile'
// stage/at = where and when the value is used: EX normally, the last ID cycle for a branch
// (compared in ID), MEM for sw's data when it comes from the lw right before it.
type Use = 'ID' | 'EX' | 'MEM'
type Dep = { i: number; p: number; reg: string; field: Field; via: Via; stage: Use; at: number; older?: number }
type Sched = { f: number[]; id: number[]; ex: number[]; stalls: number[]; cause: number[]; deps: Dep[]; total: number }

/** Cycle numbers (1-based) for each instruction's first IF, first ID and EX. */
function schedule(ins: Ins[], fwd: boolean): Sched {
  const f: number[] = [], id: number[] = [], ex: number[] = [], stalls: number[] = [], cause: number[] = [], deps: Dep[] = []
  ins.forEach((x, i) => {
    const br = x.kind === 'br'
    f[i] = i === 0 ? 1 : id[i - 1] // enters IF when the one ahead moves to ID
    id[i] = i === 0 ? 2 : ex[i - 1] // enters ID when the one ahead moves to EX
    let e = id[i] + 1
    cause[i] = -1
    const found: { s: Src; p: number; mem: boolean }[] = []
    for (const s of x.srcs) {
      if (s.reg === '$zero') continue
      let p = -1
      for (let k = i - 1; k >= 0; k--) if (ins[k].dest === s.reg) { p = k; break }
      if (p < 0) continue
      // forwarding: ALU result is ready after the producer's EX, lw data after its MEM;
      // a branch needs it one stage earlier (in ID), so one cycle more.
      // no forwarding: our last ID must be in (or after) the producer's WB.
      const lw = ins[p].kind === 'lw'
      const need = fwd ? ex[p] + (lw ? 2 : 1) + (br ? 1 : 0) : ex[p] + 3
      // sw's data is only written in MEM: with a MEM/WB → MEM path, lw → sw needs no stall
      const mem = fwd && x.kind === 'sw' && s.field === 'Rt' && lw && need > e
      if (!mem && need > e) { e = need; cause[i] = p }
      found.push({ s, p, mem })
    }
    ex[i] = e
    stalls[i] = e - (id[i] + 1)
    for (const { s, p, mem } of found) {
      const viaMem = mem && e - ex[p] < 2 // still too early for the EX path
      const stage: Use = br ? 'ID' : viaMem ? 'MEM' : 'EX'
      const at = stage === 'ID' ? e - 1 : stage === 'MEM' ? e + 1 : e
      const d = at - ex[p]
      if (d > (br ? 2 : 3)) continue // long since in the register file
      const via: Via = d === 1 ? 'exmem' : d === 2 && !br ? 'memwb' : 'regfile'
      let older: number | undefined
      if (via === 'exmem' && stage === 'EX') for (let q = p - 1; q >= 0; q--) if (ins[q].dest === s.reg) { if (e - ex[q] === 2) older = q; break }
      deps.push({ i, p, reg: s.reg, field: s.field, via, stage, at, older })
    }
  })
  return { f, id, ex, stalls, cause, deps, total: ins.length ? ex[ins.length - 1] + 2 : 0 }
}

// ---------- presets ----------
const PRESETS: { group: string; name: string; from: string; code: string }[] = [
  { group: 'Data hazards', name: 'add → sub', from: 'slides 12–16', code: 'add $s0, $t0, $t1\nsub $t2, $s0, $t3' },
  { group: 'Data hazards', name: 'Load-use', from: 'slides 17–21', code: 'lw  $s0, 20($t1)\nsub $t2, $s0, $t3' },
  { group: 'Data hazards', name: 'sub chain', from: 'slides 53–60', code: 'sub $2, $1, $3\nand $12, $2, $5\nor  $13, $6, $2\nadd $14, $2, $2\nsw  $15, 100($2)' },
  { group: 'Data hazards', name: 'Double data hazard', from: 'slides 62–63', code: 'add $1, $1, $2\nadd $1, $1, $3\nadd $1, $1, $4' },
  { group: 'Data hazards', name: 'Stall + detection', from: 'slides 67–74', code: 'lw  $2, 20($1)\nand $4, $2, $5\nor  $8, $2, $6\nadd $9, $4, $2\nslt $1, $6, $7' },
  { group: 'Data hazards', name: 'Scheduling: before', from: 'slides 22–23', code: 'lw  $t1, 0($t0)\nlw  $t2, 4($t0)\nadd $t3, $t1, $t2\nsw  $t3, 12($t0)\nlw  $t4, 8($t0)\nadd $t5, $t1, $t4\nsw  $t5, 16($t0)' },
  { group: 'Data hazards', name: 'Scheduling: after', from: 'slide 24', code: 'lw  $t1, 0($t0)\nlw  $t2, 4($t0)\nlw  $t4, 8($t0)\nadd $t3, $t1, $t2\nsw  $t3, 12($t0)\nadd $t5, $t1, $t4\nsw  $t5, 16($t0)' },
  { group: 'sw: data vs base register', name: 'add → sw (data)', from: 'slide 22 pattern', code: 'add $t3, $t1, $t2\nsw  $t3, 12($t0)' },
  { group: 'sw: data vs base register', name: 'add → sw (base)', from: 'address needed in EX', code: 'add $t0, $t1, $t2\nsw  $t3, 12($t0)' },
  { group: 'sw: data vs base register', name: 'lw → sw (data)', from: 'slide 66: memory copy', code: 'lw  $2, 20($1)\nsw  $2, 15($3)' },
  { group: 'sw: data vs base register', name: 'lw → sw (base)', from: 'address needed in EX', code: 'lw  $3, 20($1)\nsw  $2, 15($3)' },
  { group: 'Branches (decided in ID, assumed not taken)', name: 'Branch: 0 stalls', from: 'slide 79', code: 'add $1, $2, $3\nadd $4, $5, $6\nsub $7, $8, $9\nbeq $1, $4, target' },
  { group: 'Branches (decided in ID, assumed not taken)', name: 'Branch: ALU right before', from: '1 stall', code: 'add $1, $2, $3\nbeq $1, $4, target' },
  { group: 'Branches (decided in ID, assumed not taken)', name: 'Branch: lw 2 back', from: 'slide 80 · 1 stall', code: 'lw  $1, 0($2)\nadd $4, $5, $6\nbeq $1, $4, target' },
  { group: 'Branches (decided in ID, assumed not taken)', name: 'Branch: lw right before', from: 'slide 81 · 2 stalls', code: 'lw  $1, 0($2)\nbeq $1, $0, target' },
  { group: 'Branches (decided in ID, assumed not taken)', name: '2023-24 Q1(b), not taken', from: 'exam', code: '    lw  $t0, 0($s0)\n    add $t1, $t0, $s1\n    beq $t1, $zero, L1\n    add $t2, $t1, $s2\n    bne $t2, $zero, L2\n    sub $t3, $t2, $t1\nL1: and $t4, $t1, $t2\nL2: or  $t5, $t3, $t4' },
]

// ---------- drawing ----------
const LW = 230, CW = 58, RH = 38, TOP = 30
const STAGE_FILL: Record<string, string> = { IF: 'var(--stage-if-bg)', ID: 'var(--stage-id-bg)', EX: 'var(--stage-ex-bg)', MEM: 'var(--stage-mem-bg)', WB: 'var(--stage-wb-bg)' }
const VIA_COLOR: Record<Via, string> = { exmem: 'var(--fwd-exmem)', memwb: 'var(--fwd-memwb)', regfile: 'var(--ink-faint)' }
const fwdName = (f: Field) => (f === 'Rs' ? 'ForwardA' : 'ForwardB')

type Row = { kind: 'ins'; i: number } | { kind: 'bubble'; ex: number }

export function Forwarding() {
  const [code, setCode] = useState(PRESETS[2].code)
  const [fwd, setFwd] = useState(true)
  const [sel, setSel] = useState<number | null>(null)

  const parsed = useMemo(() => {
    try { return { ins: parse(code), err: '' } } catch (e) { return { ins: [] as Ins[], err: (e as Error).message } }
  }, [code])
  const { ins, err } = parsed
  const s = useMemo(() => schedule(ins, fwd), [ins, fwd])

  // bubble rows go just above the instruction that stalled (slide 73)
  const rows: Row[] = []
  ins.forEach((_, i) => {
    for (let c = s.id[i] + 1; c < s.ex[i]; c++) rows.push({ kind: 'bubble', ex: c })
    rows.push({ kind: 'ins', i })
  })
  const rowOf = (i: number) => rows.findIndex((r) => r.kind === 'ins' && r.i === i)
  const cx = (c: number) => LW + (c - 1) * CW
  const ry = (r: number) => TOP + r * RH
  const W = LW + Math.max(s.total, 6) * CW + 8
  const H = TOP + rows.length * RH + 6
  const totalStalls = s.stalls.reduce((a, b) => a + b, 0)

  const cell = (key: string, c: number, r: number, label: string, mode: 'normal' | 'stall' | 'bubble') => (
    <g key={key}>
      <rect x={cx(c) + 3} y={ry(r) + 4} width={CW - 6} height={RH - 8} rx={6}
        fill={mode === 'bubble' ? 'var(--card)' : mode === 'stall' ? 'url(#hatch)' : STAGE_FILL[label]}
        stroke={mode === 'bubble' ? 'var(--bubble-border)' : 'var(--stage-border)'} strokeDasharray={mode === 'bubble' ? '4 3' : undefined} />
      <text x={cx(c) + CW / 2} y={ry(r) + RH / 2 + 5} textAnchor="middle" fontSize={14}
        fill={mode === 'normal' ? 'var(--ink)' : 'var(--ink-faint)'} fontWeight={mode === 'normal' ? 600 : 400}>{mode === 'bubble' ? 'nop' : label}</text>
    </g>
  )

  return (
    <div className="page">
      <header className="page-head">
        <p className="crumb">Chapter 4 Part 2 · slides 12–24, 53–76 · asked in 9 of 14 papers</p>
        <h1>Data hazards, forwarding and stalls</h1>
        <p className="lede">Type MIPS code or pick a slide example. The pipeline diagram shows where each value is <b>ready</b>, where it's <b>needed</b>, which forwarding path the forwarding unit picks, and where the hazard detection unit inserts a stall.</p>
      </header>

      <div className="layout">
        <section className="diagram-col">
          {[...new Set(PRESETS.map((p) => p.group))].map((g) => (
            <div key={g} className="presets">
              <h3 className="preset-group">{g}</h3>
              <div className="scen">
                {PRESETS.filter((p) => p.group === g).map((p) => (
                  <button key={p.name} className={code === p.code ? 'on' : ''} onClick={() => { setCode(p.code); setSel(null) }}>
                    {p.name}<small>{p.from}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="code-row">
            <textarea className="code-in" value={code} spellCheck={false} rows={Math.max(3, code.split('\n').length)}
              onChange={(e) => { setCode(e.target.value); setSel(null) }} />
            <div className="design-switch">
              <button className={fwd ? 'on' : ''} onClick={() => setFwd(true)}>With forwarding<small>+ hazard detection unit</small></button>
              <button className={!fwd ? 'on' : ''} onClick={() => setFwd(false)}>No forwarding<small>wait for the register file</small></button>
            </div>
          </div>
          {err && <p className="err">{err}</p>}
          {ins.some((x) => x.kind === 'br') && (
            <p className="tiny">Branches are decided in ID (comparator + target adder in ID) and assumed <b>not taken</b>, so the next instructions follow in order. A taken branch would add 1 flushed cycle.</p>
          )}

          {!err && ins.length > 0 && (
            <div className="diagram-card pipe-card">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Pipeline diagram">
                <defs>
                  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="var(--bg)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--stall-hatch)" strokeWidth="3" />
                  </pattern>
                  {(Object.keys(VIA_COLOR) as Via[]).map((v) => (
                    <marker key={v} id={`ah-${v}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill={VIA_COLOR[v]} />
                    </marker>
                  ))}
                </defs>
                {Array.from({ length: s.total }, (_, k) => (
                  <text key={k} x={cx(k + 1) + CW / 2} y={18} textAnchor="middle" fontSize={13} fill="var(--muted)">CC{k + 1}</text>
                ))}
                {rows.map((row, r) => {
                  if (row.kind === 'bubble') {
                    return (
                      <g key={`b${r}`}>
                        <text x={8} y={ry(r) + RH / 2 + 5} fontSize={13} fill="var(--ink-faint)" fontStyle="italic">bubble</text>
                        {['EX', 'MEM', 'WB'].map((st, k) => cell(`b${r}${k}`, row.ex + k, r, st, 'bubble'))}
                      </g>
                    )
                  }
                  const i = row.i
                  const out = [<text key="t" x={8} y={ry(r) + RH / 2 + 5} fontSize={14} fontFamily="Consolas, monospace" fill="var(--ink)">{ins[i].text}</text>]
                  for (let c = s.f[i]; c < s.id[i]; c++) out.push(cell(`f${c}`, c, r, 'IF', c === s.f[i] ? 'normal' : 'stall'))
                  for (let c = s.id[i]; c < s.ex[i]; c++) out.push(cell(`d${c}`, c, r, 'ID', c === s.id[i] ? 'normal' : 'stall'))
                  ;['EX', 'MEM', 'WB'].forEach((st, k) => out.push(cell(st, s.ex[i] + k, r, st, 'normal')))
                  return <g key={`i${i}`}>{out}</g>
                })}
                {s.deps.map((d, k) => {
                  const rp = rowOf(d.p), ri = rowOf(d.i)
                  const on = sel === null || sel === k
                  const col = VIA_COLOR[d.via]
                  let pts: string
                  if (d.via === 'regfile') {
                    // written in the first half of WB, read in the second half of ID (same cycle)
                    const x = cx(s.ex[d.p] + 2)
                    pts = `${x + CW * 0.3},${ry(rp) + RH - 4} ${x + CW * 0.7},${ry(ri) + 4}`
                  } else {
                    // from the pipeline register at the end of the producer's cell into the stage that uses it
                    const x = cx(d.at)
                    const off = d.field === 'Rs' ? -6 : 6
                    pts = `${x - CW * 0.3},${ry(rp) + RH - 6} ${x + CW * 0.35 + off},${ry(ri) + 5}`
                  }
                  // double data hazard: the older MEM/WB value the revised condition ignores
                  const ignored = d.older !== undefined && (() => {
                    const x = cx(s.ex[d.i]), ro = rowOf(d.older!)
                    return <g opacity={on ? 0.75 : 0.2}>
                      <polyline points={`${x - CW * 0.3},${ry(ro) + RH - 6} ${x + CW * 0.2},${ry(ri) + 5}`} fill="none" stroke={VIA_COLOR.memwb} strokeWidth={1.6} strokeDasharray="3 3" />
                      <text x={x - CW * 0.05} y={(ry(ro) + RH + ry(ri)) / 2 + 6} textAnchor="middle" fontSize={17} fill={VIA_COLOR.memwb} fontWeight={700} stroke="var(--card)" strokeWidth={3} paintOrder="stroke">✗</text>
                    </g>
                  })()
                  return (
                    <g key={k}>{ignored}<polyline points={pts} fill="none" stroke={col} strokeWidth={on ? 2.6 : 1.2} opacity={on ? 1 : 0.25}
                      strokeDasharray={d.via === 'regfile' ? '5 4' : undefined} markerEnd={`url(#ah-${d.via})`} /></g>
                  )
                })}
              </svg>
            </div>
          )}

          <div className="legend">
            <span><i style={{ background: VIA_COLOR.exmem }} />from EX/MEM (Forward = 10)</span>
            <span><i style={{ background: VIA_COLOR.memwb }} />from MEM/WB (Forward = 01)</span>
            <span><i style={{ background: VIA_COLOR.regfile }} />register file: write 1st half, read 2nd half</span>
            <span><i style={{ background: 'var(--stall-hatch)' }} />stalled (stage repeats)</span>
            {s.deps.some((d) => d.older !== undefined) && <span style={{ color: VIA_COLOR.memwb }}>✗ older MEM/WB value, ignored</span>}
          </div>

          <h2>The rules the hardware uses</h2>
          <div className="eqs">
            <div>
              <h3>Forwarding unit (in EX) · slides 61, 64</h3>
              <pre>{`EX hazard (newest value, from EX/MEM):
if (EX/MEM.RegWrite
    and EX/MEM.RegisterRd ≠ 0
    and EX/MEM.RegisterRd = ID/EX.RegisterRs)  ForwardA = 10
  (same with ID/EX.RegisterRt → ForwardB = 10)

MEM hazard (older value, from MEM/WB),
revised for the double data hazard:
if (MEM/WB.RegWrite
    and MEM/WB.RegisterRd ≠ 0
    and not (EX/MEM.RegWrite and EX/MEM.RegisterRd ≠ 0
             and EX/MEM.RegisterRd = ID/EX.RegisterRs)
    and MEM/WB.RegisterRd = ID/EX.RegisterRs)  ForwardA = 01
  (same with Rt → ForwardB = 01)

Otherwise ForwardA/B = 00
  (value from the register file)`}</pre>
              <table className="truth mux-tab">
                <thead><tr><th>Mux control</th><th>ALU input comes from</th></tr></thead>
                <tbody>
                  <tr><td>00</td><td>ID/EX: the register file read</td></tr>
                  <tr><td>10</td><td>EX/MEM: the ALU result of the previous instruction</td></tr>
                  <tr><td>01</td><td>MEM/WB: data memory or an older ALU result</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <h3>Hazard detection unit (in ID) · slide 69</h3>
              <pre>{`if (ID/EX.MemRead
    and (ID/EX.RegisterRt = IF/ID.RegisterRs
         or ID/EX.RegisterRt = IF/ID.RegisterRt))
  stall the pipeline 1 cycle`}</pre>
              <h3>How it stalls · slide 72</h3>
              <ul className="plain-steps">
                <li>Force the control values in ID/EX to 0, so EX, MEM and WB do a nop (the <b>bubble</b>).</li>
                <li>Set PCWrite = 0 and IF/IDWrite = 0, so the PC and IF/ID keep their values.</li>
                <li>So the using instruction is decoded again and the next one is fetched again.</li>
                <li>One cycle later, lw's data is in MEM/WB and is forwarded with Forward = 01.</li>
              </ul>
            </div>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-block">
            <h3>Total</h3>
            <p className="mono big">5 + ({ins.length} − 1) + {totalStalls} = {s.total} cycles</p>
            <p className="tiny">5 stages + one more cycle per extra instruction + stall cycles.</p>
          </div>
          <div className="panel-block">
            <h3>Each dependence {s.deps.length > 0 && <span className="tiny">(click to highlight)</span>}</h3>
            {s.deps.length === 0 && <p className="tiny">No close dependences. Nothing to forward.</p>}
            <ul className="deps">
              {s.deps.map((d, k) => {
                const p = ins[d.p], fn = fwdName(d.field)
                return (
                  <li key={k} className={sel === k ? 'on' : ''} onClick={() => setSel(sel === k ? null : k)}>
                    <p><code>{ins[d.i].text}</code> needs <b>{d.reg}</b> ({d.field === 'Rs' ? 'rs' : 'rt'}) from <code>{p.text}</code></p>
                    {d.stage === 'EX' && d.via === 'exmem' && <p><b style={{ color: VIA_COLOR.exmem }}>EX hazard.</b> {fn} = 10. The producer is one ahead, so the value sits in EX/MEM: EX/MEM.RegisterRd = {d.reg} = ID/EX.Register{d.field}.</p>}
                    {d.stage === 'EX' && d.via === 'memwb' && <p><b style={{ color: VIA_COLOR.memwb }}>MEM hazard.</b> {fn} = 01. {p.kind === 'lw' ? 'lw data comes out of memory, so it is only in MEM/WB' : 'The producer is two ahead, so the value sits in MEM/WB'}: MEM/WB.RegisterRd = {d.reg} = ID/EX.Register{d.field}.</p>}
                    {d.stage === 'EX' && d.via !== 'regfile' && ins[d.i].kind === 'sw' && d.field === 'Rt' && <p className="tiny">sw's data goes through the ForwardB mux in EX, then EX/MEM carries it to the data memory in MEM.</p>}
                    {d.stage === 'EX' && ins[d.i].kind === 'sw' && d.field === 'Rs' && d.via !== 'regfile' && <p className="tiny">This is sw's base register: the address is added in EX, so it must be there by EX.</p>}
                    {d.stage === 'ID' && d.via === 'exmem' && <p><b style={{ color: VIA_COLOR.exmem }}>Forwarded into ID.</b> The branch compares in ID, so {d.reg} goes from EX/MEM straight to the comparator in CC{d.at}.</p>}
                    {d.stage === 'MEM' && <p><b style={{ color: VIA_COLOR.memwb }}>Forwarded into MEM.</b> sw only writes its data in MEM (CC{d.at}). lw's value is in MEM/WB by then, so it goes straight to the data memory's write input. No stall. This needs the extra MEM/WB → MEM path; the slide-69 detection unit alone would stall here.</p>}
                    {d.via === 'regfile' && <p><b>No forwarding needed.</b> {fwd ? '' : 'After stalling, '}{d.reg} is written in the first half of CC{s.ex[d.p] + 2} and read{d.stage === 'ID' ? ' by the comparator' : ''} in the second half of the same cycle.</p>}
                    {d.older !== undefined && <p className="warn">Double data hazard: <code>{ins[d.older].text}</code> also wrote {d.reg} and sits in MEM/WB. Both conditions are true. The revised MEM condition says "not if the EX hazard holds", so the newer EX/MEM value wins.</p>}
                  </li>
                )
              })}
            </ul>
          </div>
          {totalStalls > 0 && (
            <div className="panel-block">
              <h3>Stalls</h3>
              <ul className="deps">
                {ins.map((x, i) => s.stalls[i] > 0 && (
                  <li key={i}>
                    <p><code>{x.text}</code> waits <b>{s.stalls[i]}</b> cycle{s.stalls[i] > 1 ? 's' : ''} in ID.</p>
                    {!fwd
                      ? <p>No forwarding, so it must read the register file in (or after) the producer's WB.</p>
                      : x.kind === 'br'
                        ? <p>A branch compares in ID, one stage earlier than EX. <code>{ins[s.cause[i]].text}</code> has {ins[s.cause[i]].dest} only at the end of its {ins[s.cause[i]].kind === 'lw' ? 'MEM' : 'EX'} (CC{s.ex[s.cause[i]] + (ins[s.cause[i]].kind === 'lw' ? 1 : 0)}), so the comparison waits until CC{s.ex[i] - 1}.</p>
                        : <p>Hazard detection in CC{s.id[i]}: ID/EX.MemRead = 1 (<code>{ins[s.cause[i]].text}</code> is a load) and ID/EX.RegisterRt = {ins[s.cause[i]].dest} matches IF/ID.Rs or Rt.</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
