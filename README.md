# MIPS Processor Simulator

Interactive single-cycle datapath lessons, a forwarding timing explorer, and a clock-driven five-stage pipeline lab. Built with React, TypeScript, Vite, CSS/SVG, and KaTeX. All computation runs in the browser; no backend or database is required.

## Run locally

Use Node.js 24 and npm (verified with Node 24.11.1).

```powershell
npm ci
npm run dev
```

Open http://localhost:5173. Choose **Pipeline lab**, or open http://localhost:5173/#/pipeline-lab directly. Stop the development server with Ctrl+C.

```powershell
npm test        # Pipeline regression tests and sequential-reference comparison
npm run lint   # Oxlint
npm run build  # Type-check and generate dist/
npm run preview
```

## Task 1: Pipeline lab

The lab draws the pipelined datapath from Chapter 4 Part 2: slide 52's datapath and control, slide 65's forwarding unit and slide 75's hazard detection unit. It uses the same shapes as the single-cycle lessons. Branch hardware is left out until the control-hazard lesson.

1. Pick one of the 18 cases. Each is tied to a slide: the slide 53 chain, EX/MEM and MEM/WB hazards, the double data hazard, first-half write / second-half read, RegWrite and $zero checks, ALU → store, load-use stalls, lw → sw, a stall without a real dependence, two loads in a row, and code scheduling before and after. You can also type your own program.
2. Read **The program** and **Hazards in this program**. They list each dependence, how the hardware resolves it (EX/MEM, MEM/WB, register file, stall) and the cycle count 5 + (n − 1) + stalls.
3. Clock the processor with **Next ▶** or the → key. Each cycle has four steps, and empty steps are skipped:
   - **↑ Clock edge**: the pipeline registers and PC latch. Changed fields are highlighted, and a held PC or IF/ID is marked.
   - **1st half**: WB writes the register file.
   - **2nd half**: ID reads the registers, the hazard detection unit checks slide 69's condition, and IF fetches.
   - **EX + MEM**: the forwarding unit evaluates slides 61/64 with real register numbers, then the ALU and data memory run.
   **Spotlight** dims everything a step does not use. **Show values** puts the values on the wires. Shift + arrow moves a whole cycle, and clicking the timing chart jumps to any cycle.

Colours: orange = forwarded from EX/MEM (10), purple = from MEM/WB (01), red = hazard detection / stall, teal = register-file write and read, grey = not used this cycle.

## Hardware model (exactly the slides)

- Forwarding unit: slide 61 EX hazard, slide 64 revised MEM hazard (EX/MEM wins a double data hazard). It compares register numbers only, so ForwardB can fire for an I-format rt that is really a destination. ALUSrc then ignores it, and the lab says so.
- Hazard detection unit: slide 69, `ID/EX.MemRead and (ID/EX.RegisterRt = IF/ID.RegisterRs or ID/EX.RegisterRt = IF/ID.RegisterRt)`. This means `lw` followed by `sw` of the loaded register stalls one cycle. There is no MEM-to-MEM forwarding path. It also stalls conservatively when `rt` is only a destination (e.g. `lw $2` then `addi $2, $5, 7`).
- Stall (slides 71–72): PCWrite = 0, IF/IDWrite = 0, and the control mux puts 0 into every ID/EX control bit. The bubble's data fields are still latched, but nothing uses them.
- Register file: written in the first half and read in the second half (slide 55).
- Control from slide 51. ALU control from funct[3:0] when ALUOp = 10, add otherwise. `nop` is `sll $0,$0,0`: an R-format word that writes $zero, which is ignored. For sw, RegDst and MemtoReg are shown as X.
- Supported: add, sub, and, or, slt, nor, addi, lw, sw, nop (the operations the slide ALU control handles). Branches and jumps are rejected until the next lesson. Values are 32-bit signed and wrap. Memory addresses must be multiples of 4. At most 24 instructions.
- Registers are shown the way the program writes them: `$2` style as on the slides, or `$t0` style.

## Code layout

- src/pipeline/engine.ts: parser and encoder, control, cycle-by-cycle simulation (latches, forwarding checks, hazard checks), dependence summary.
- src/pipeline/explain.ts: clock sub-steps and the explanation for each step.
- src/pipeline/PipelineDatapath.tsx: the slide-style SVG datapath, driven by one simulated cycle and step.
- src/pipeline/examples.ts: the teaching cases with their slide references.
- src/lessons/PipelineLab.tsx: the lab page (overview, clock, explanation, pipeline register contents, timing chart, register file, memory).
- tests/pipeline.test.mjs: slide-by-slide regression tests and 150 random programs checked against a one-instruction-at-a-time interpreter.

The older diagram modules have Fast Refresh lint warnings, and the production build reports a chunk-size warning. Neither affects running or building the app.
