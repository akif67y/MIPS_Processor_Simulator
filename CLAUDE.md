# CSE 209 Lab (MIPS processor simulator)

## Design workflow

- Design system: https://claude.ai/artifact/DjgySuC5vrPExJh3U2phXh (read `project/README.md` and `project/tokens.json`)
- Design canvas: https://claude.ai/artifact/HDeVWa8RxPmC6XGcJbEg9a (read `project/canvas.json` and the boards titled READY)

Rules:

- Designs are made in a separate Claude Design chat; this repo only builds them.
- Only build boards whose title starts with **READY**. Boards titled NOT CHOSEN are history, and DRAFT boards (for example the "Control hazards" canvas page) are not built yet.
- The design system's tokens (`project/tokens.json`) and `src/tokens.css` must stay identical: same names, same values. When one changes, update the other in the same piece of work, and keep the design system's README in step with the code.
- If something can't be built as drawn, stop and report it back so the design can be adjusted. Don't improvise.
