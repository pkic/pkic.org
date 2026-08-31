/**
 * Renders the token module as a stylesheet.
 *
 * Kept beside the tokens rather than inside the build script so the same
 * output can be produced at runtime (a Worker rendering a page server-side
 * needs the identical bytes) and asserted in a unit test.
 *
 * The emitted sheet declares the site-wide layer order and puts every token
 * inside `@layer tokens`, so it wins over the quarantined legacy stylesheet
 * regardless of which one the browser happens to load first.
 */

import { accentNeighbour, palette, type AccentHue } from "./palette.ts";
import { constants, cssVar, density, layers, themes } from "./tokens.ts";

function block(entries: Record<string, string>, indent: string): string {
  return Object.entries(entries)
    .map(([name, value]) => `${indent}${cssVar(name)}: ${value};`)
    .join("\n");
}

/** The default accent, and the neighbour its duo gradient runs toward. */
function accentPair(hue: AccentHue): Record<string, string> {
  return { accent: palette[hue], "accent-2": palette[accentNeighbour[hue]] };
}

export function emitTokenCss(defaultAccent: AccentHue = "green"): string {
  const paletteEntries = Object.fromEntries(Object.entries(palette).map(([name, value]) => [`palette-${name}`, value]));

  return `/*
 * GENERATED FILE — do not edit.
 *
 * Source: assets/design/tokens.ts and assets/design/palette.ts
 * Regenerate: pnpm run build:tokens
 *
 * \`pnpm run check\` fails if this file drifts from the module.
 */
@layer ${layers.join(", ")};

@layer tokens {
  :root {
${block(paletteEntries, "    ")}

${block(accentPair(defaultAccent), "    ")}

${block(constants, "    ")}

${block(density.comfortable, "    ")}

${block(themes.light, "    ")}
  }

  /* The un-stamped document is the common case: most viewers never choose a
     theme, so only prefers-color-scheme separates them. Guarding on
     :not([data-theme="light"]) lets an explicit light choice beat a dark OS. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
${block(themes.dark, "      ")}
    }
  }

  /* Stamped explicitly, so the toggle also wins in the other direction. */
  :root[data-theme="dark"] {
${block(themes.dark, "    ")}
  }

  [data-density="compact"] {
${block(density.compact, "    ")}
  }
}
`;
}
