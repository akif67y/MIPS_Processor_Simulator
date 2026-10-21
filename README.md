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

Select a case, read its explanation, then give the processor a clock:

- **Next half-cycle** separates WB's first-half register write from ID's second-half read. The following half-cycle advances all pipeline latches at the cycle edge.
- **Next clock +1** advances one full cycle, preserving the selected half where possible.
- **Back half**, **Reset**, **Finish**, the time slider, and clickable timing-chart columns let you inspect/replay the trace. Rewinding restores registers and memory as well as instructions.
- The large datapath highlights EX/MEM and MEM/WB forwarding, the ALU-input multiplexers, hazard detection, freeze controls, and the store-data bypass.
- The four pipeline-register panels show latched data, register numbers, extended immediates, destination registers, and EX/MEM/WB controls. Each panel previews its values at the next clock edge.
- The instruction timing chart and bubble rows come from the same execution snapshots as the datapath. Future columns are pale. Architectural registers and data memory appear below.
- Edit the program or initial register/memory assignments, then press **Load program & reset**. Invalid programs retain the previously loaded simulation and show a diagnostic.

The 15 examples cover both forwarding inputs, each forwarding source, simultaneous forwarding from different sources, competing writers, load-use stalls, a load with an instruction gap, same-cycle WB/ID access, store data versus base dependencies, and exclusions for $zero and destination-only operands.

## Model and scope

The implementation follows the supplied **Chapter 4 (Part 2)** slides 53-65 and 67-75 and chapter 11 of **MIPS_Pipelining_FloatingPoint_Textbook**. Slide 55 defines first-half writes and second-half reads. The other single-cycle lessons remain available.

This version includes the additional **MEM/WB to data-memory write input** path discussed by slide 66 and textbook section 11.5.1. Consequently, lw immediately followed by sw of the loaded value needs no stall when only the store data depends on the load. A dependent store base still stalls. This is an explicit refinement of the basic slide-69 detector, which would conservatively stall either case.

- Five in-order stages: IF, ID, EX, MEM, WB; separate instruction and data memories; single-cycle memory.
- EX/MEM wins over an older MEM/WB writer. Load addresses are never treated as loaded values. A pending newer load also blocks forwarding an older matching writer.
- A load-use stall holds PC and IF/ID, injects zero controls into ID/EX, and lets older stages advance. Inserted bubbles remain visible until they drain.
- Stores commit at the cycle edge. Register writes commit between the first and second halves. The clock starts at cycle 1 with an empty pipeline and PC=0; fetch stops at the program end while occupied stages drain.
- All unspecified registers and memory words start at zero. $zero cannot change. Register aliases resolve to the same numeric register. Memory uses aligned byte addresses and 32-bit words.
- Values are signed 32-bit integers, with unsigned hexadecimal available. Arithmetic wraps; overflow exceptions are not modeled. Unaligned memory accesses are rejected with the cycle/instruction/address identified.
- ALUOp=00 selects addition; 10 decodes R-format. The model extends ALUOp=11 to logical/comparison immediate instructions. The decoded ALU operation is displayed separately.
- Supported: add, addu, sub, subu, and, or, xor, nor, slt, sltu, addi, addiu, andi, ori, xori, slti, sltiu, lw, sw, nop. Signed immediates are -32768 to 32767; logical immediates are 0 to 65535. Decimal/hexadecimal inputs and # comments are accepted.
- Up to 64 instructions per trace. Branches, jumps, labels, pseudo-instructions, exceptions, no-forwarding variants, and branch-in-ID variants are outside Task 1. Unsupported instructions are rejected explicitly.

## Code layout

- src/pipeline/engine.ts: pure parser, decoder, half-cycle execution model, forwarding selections, and dependency analysis.
- src/pipeline/examples.ts: editable teaching examples and their initial state.
- src/pipeline/PipelineDatapath.tsx: full SVG datapath driven by execution snapshots.
- src/lessons/PipelineLab.tsx: clock controls, explanations, state inspectors, and timing chart.
- tests/pipeline.test.mjs: timing/forwarding/stall regressions and 100 deterministic randomized programs checked against an independent sequential interpreter.

The existing repository has Fast Refresh lint warnings in its older diagram modules and a production chunk-size warning. They do not prevent running or building the app.
