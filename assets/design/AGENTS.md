# Design token guidance

- This directory is the single source for color, type, space, radius, shadow,
  motion, and density. No other file may declare one of those values.
- `palette.ts` holds raw brand colors with no meaning attached. Components
  never read them. `tokens.ts` holds the semantic names components do read.
- Both themes must define the same token names. A color defined only inside a
  theme-conditional block renders one theme's text on the other theme's ground;
  `tests/frontend/design-tokens.test.ts` fails that case.
- The accent takes one input, `--pk-accent`. Strong, ink, soft and gradient
  variants derive from it per theme. Do not add per-hue lookup tables.
- State tones (ok/warn/danger/info) are independent of the accent and stay that
  way: on a green-accented product an accent-derived "success" is unreadable as
  a status.
- `tokens.generated.css` is generated. Edit the module and run
  `pnpm run build:tokens`; `pnpm run check` fails on drift.
- Stylesheets read the generated stylesheet's custom properties; bundles import
  it as CSS (for example `assets/ts/design-system.ts`). TypeScript that needs a
  value imports the module directly so the values stay one definition, not two.
- Every component stylesheet declares its rules inside a cascade layer,
  normally `@layer components`. An unlayered rule outranks every utility and
  component whatever its specificity; `pnpm run check:css-layers` fails one.
