# MIPS Processor Simulator

Interactive single-cycle datapath lessons, a forwarding timing explorer, and clock-driven five-stage pipeline labs for data hazards, control hazards and branch prediction. Built with React, TypeScript, Vite, CSS/SVG, and KaTeX. All computation runs in the browser; no backend or database is required.

## Run locally

Use Node.js 24 and npm (verified with Node 24.11.1).

```powershell
npm ci
npm run dev
```

Open http://localhost:5173 and choose a lesson in the top bar. The pipeline lessons follow Chapter 4 Part 2:

| Page | Address | Slides |
| --- | --- | --- |
| Data hazards | `#/data-hazards` (the old `#/pipeline-lab` still works) | 52–75 |
| Control hazards | `#/control-hazards` | 25–31, 77–81 |
| Branch prediction | `#/branch-prediction` | 82–85 |

Stop the development server with Ctrl+C.

```powershell
npm test        # Pipeline regression tests and sequential-reference comparison
npm run lint   # Oxlint
npm run build  # Type-check and generate dist/
npm run preview
```

## Data hazards lab

The lab draws the pipelined datapath from Chapter 4 Part 2: slide 52's datapath and control, slide 65's forwarding unit and slide 75's hazard detection unit. It uses the same shapes as the single-cycle lessons. Branch hardware is in the control-hazard lab.

1. Pick a case from the example menu at the top (18 cases, each tied to a slide: the slide 53 chain, EX/MEM and MEM/WB hazards, the double data hazard, first-half write / second-half read, RegWrite and $zero checks, stores, load-use stalls, lw → sw, a stall without a real dependence, two loads in a row, code scheduling before and after). **✎ Edit code** opens the editor for your own program.
2. The overview opens first: what the case shows, the program, every dependence and how the hardware resolves it (EX/MEM, MEM/WB, register file, stall), and the cycle count 5 + (n − 1) + stalls. Press **Start clocking**. The summary button in the program bar (cycles · stalls · forwards) reopens it.
3. Clock the processor with **Next ▶** or the → key in the sticky toolbar. Two views, switched in the toolbar (your choice is remembered):
   - **Whole cycle** (default): one click = one clock cycle. All stages are lit at once, as they work in hardware; each stage's region and data wires take the colour of the instruction in it. Below the diagram, a timing strip shows the real timing (every stage runs from edge to edge; only the register file is split: write in the 1st half, read in the 2nd half, slide 55), then one card per stage (IF, ID, EX, MEM, WB) with short badges. **Show details** puts the full explanation in every card.
   - **Focus steps**: the same cycle read one part at a time. This is a reading order, not a time order; the timing strip highlights the part in focus and shows that it runs at the same time as the rest.
     - **↑ Edge**: the pipeline registers and PC latch. A held PC or IF/ID is marked.
     - **WB write**: WB writes the register file (1st half).
     - **ID read · IF**: ID reads the registers (2nd half); the hazard detection unit checks slide 69's condition and IF fetches.
     - **EX · MEM**: the forwarding unit evaluates slides 61/64 with real register numbers, then the ALU and data memory run.
     Empty steps are skipped. **Spotlight** dims everything a step does not use. Shift + arrow moves a whole cycle.
   The explanation sits under the diagram (beside it on screens 1900 px and wider). **Values** puts the values on the wires.
4. **Show more** adds panels under the simulator: the timing chart (on by default; click a cycle to jump there), pipeline register contents (now and next edge), the register file and memory, and the hardware rules. Your choice is remembered in this browser.

Colours: orange = forwarded from EX/MEM (10), purple = from MEM/WB (01), red = hazard detection / stall, teal = register-file write and read, grey = not used this cycle.

## Control hazards lab

Same simulator, with branch hardware added to the big diagram. Two choices above the overview pick the hardware:

- **Branch decided in MEM** (slide 77, Fig. 4.51): shift left 2 and an adder in EX compute the target, the ALU subtracts for Zero, and PCSrc = Branch AND Zero in MEM. A taken branch flushes three instructions: IF.Flush (IF/ID ← 0, the nop word), ID.Flush and EX.Flush (controls 0).
- **Branch decided in ID** (slide 78, Fig. 4.62): the target adder and an "=" comparator sit in ID, with EX/MEM.ALUResult forwarded into the comparator (ForwardC/ForwardD, slide 79). The hazard detection unit also stalls a branch whose register is still being computed: ALU right before or lw two before = 1 stall (slide 80), lw right before = 2 stalls (slide 81). A taken branch flushes one instruction (IF.Flush).
- **After a branch**: predict not taken (slides 28–29), stall on branch (slides 26–27: every fetch is thrown away until the branch is decided), or delayed branch (slide 31: the next instruction always runs; ID only).

Both add a PC mux in IF and a band above the diagram that carries PCSrc and the branch target back to it. In focus steps, each cycle gets a fifth step, **Branch**, whenever a branch is decided (or the pipeline is waiting for one): target, comparator or Zero, PCSrc, and what the next edge flushes. In the whole-cycle view it is a card above the stage cards. Colours: green = taken branch (target → PC), pink = flushed or thrown away.

The 17 examples follow the slides: slide 77 taken and not taken, a load-use stall and a flush in the same cycle (the flush wins), slide 78, slides 26–29 (stall vs predict, correct and incorrect), slides 79–81 (forward, 1 stall, 2 stalls), slide 31 (delay slot filled, and a nop in the slot), and a counting loop before and after scheduling. The overview lists every branch execution (taken or not, slots thrown away, stalls, forwarding), the cycle count 5 + (n − 1) + stalls + thrown away, and the cycle count of the same program on all five hardware choices. The timing chart has one row per executed instance (a loop body fetched three times gets three rows), pink rows for flushed instructions, and a green arrow from each taken branch to its target fetch.

Programs can use labels (`loop:`), beq/bne with a label or a word offset, and an address in front of a line (`40: beq $1, $3, 7`, as on slide 78; a gap holds zero words, which are nop). A program that runs for more than 160 cycles is stopped as an endless loop.

## Branch prediction

Slides 82–85: a 1-bit and a 2-bit predictor side by side, stepped one branch at a time over slide 83's nested loop (inner and outer iterations adjustable) or your own T/N sequence. Each shows the slide-84-style state machine with the transition just taken, the 8-entry branch history table (indexed by PC bits 4–2), and its accuracy. A cost table compares predict-not-taken, 1-bit and 2-bit with and without a branch target buffer, for an outcome known 1 (ID), 3 (MEM) or 10 cycles after the fetch; the BTB panel shows its entries and whether each fetch hits.

## Hardware model (exactly the slides)

- Forwarding unit: slide 61 EX hazard, slide 64 revised MEM hazard (EX/MEM wins a double data hazard). It compares register numbers only, so ForwardB can fire for an I-format rt that is really a destination. ALUSrc then ignores it, and the lab says so.
- Hazard detection unit: slide 69, `ID/EX.MemRead and (ID/EX.RegisterRt = IF/ID.RegisterRs or ID/EX.RegisterRt = IF/ID.RegisterRt)`. This means `lw` followed by `sw` of the loaded register stalls one cycle. There is no MEM-to-MEM forwarding path. It also stalls conservatively when `rt` is only a destination (e.g. `lw $2` then `addi $2, $5, 7`).
- Stall (slides 71–72): PCWrite = 0, IF/IDWrite = 0, and the control mux puts 0 into every ID/EX control bit. The bubble's data fields are still latched, but nothing uses them.
- Register file: written in the first half and read in the second half (slide 55).
- Control from slide 51. ALU control from funct[3:0] when ALUOp = 10, subtract when ALUOp = 01 (beq/bne), add otherwise. `nop` is `sll $0,$0,0`: an R-format word that writes $zero, which is ignored. For sw, beq and bne, RegDst and MemtoReg are shown as X.
- Branches (control-hazard lab only): beq and bne. bne uses the same hardware with NOT Zero / NOT Equal. A taken branch decided in MEM overrides a load-use stall in the same cycle. The data-hazard lab rejects branches and labels.
- Supported: add, sub, and, or, slt, nor, addi, lw, sw, nop, plus beq and bne in the control-hazard lab. Values are 32-bit signed and wrap. Memory addresses must be multiples of 4. At most 24 instructions.
- Registers are shown the way the program writes them: `$2` style as on the slides, or `$t0` style.

## Code layout

- src/pipeline/engine.ts: parser and encoder, control, cycle-by-cycle simulation (latches, forwarding checks, hazard checks, branch decision, flushes), dependence and branch summaries. `simulate(..., hw)` takes the branch hardware; without it the data-hazard model is unchanged.
- src/pipeline/explain.ts: clock sub-steps, the explanation for each step, and the whole-cycle view (stage cards).
- src/pipeline/PipelineDatapath.tsx: the slide-style SVG datapath, driven by one simulated cycle and step. With branch hardware it widens the sheet (a coordinate warp) to fit the added units.
- src/pipeline/examples.ts, src/pipeline/branchExamples.ts: the teaching cases with their slide references.
- src/pipeline/predictor.ts: 1-bit / 2-bit predictors, branch history table, BTB and cycle costs.
- src/lessons/PipelineLab.tsx: the data-hazard and control-hazard pages (overview, hardware choice, clock, explanation, pipeline register contents, timing chart, register file, memory, rules).
- src/lessons/BranchPrediction.tsx: the branch prediction page.
- tests/pipeline.test.mjs: data-hazard regression tests and 150 random programs checked against a one-instruction-at-a-time interpreter.
- tests/control.test.mjs: slides 26–31 and 77–85, every control example on every hardware choice, and 120 random programs with branches (all five hardware choices) checked against an interpreter.

The older diagram modules have Fast Refresh lint warnings, and the production build reports a chunk-size warning. Neither affects running or building the app.
