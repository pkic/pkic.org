# Design token guidance

- This directory is the single source for colour, type, space, radius, shadow,
  motion, and density. No other file may declare one of those values.
- `palette.ts` holds raw brand colours with no meaning attached. Components
  never read them. `tokens.ts` holds the semantic names components do read.
- Both themes must define the same token names. A colour defined only inside a
  theme-conditional block renders one theme's text on the other theme's ground;
  `tests/frontend/design-tokens.test.ts` fails that case.
- The accent takes one input, `--pk-accent`. Strong, ink, soft and gradient
  variants derive from it per theme. Do not add per-hue lookup tables.
- State tones (ok/warn/danger/info) are independent of the accent and stay that
  way: on a green-accented product an accent-derived "success" is unreadable as
  a status.
- `tokens.generated.css` is generated. Edit the module and run
  `pnpm run build:tokens`; `pnpm run check` fails on drift.
- Consumers that only speak CSS (Hugo layouts, the Marp deck theme, rendered
  documents) read the generated stylesheet. TypeScript consumers import the
  module directly so the values stay one definition, not two.
