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
import { constants, cssVar, density, layers, radiusModes, themes } from "./tokens.ts";

/**
 * Tokens the public site alone reads.
 *
 * The entry stylesheet is linked on every authenticated page, and the published
 * site's headline scale, working-group accents and hero gradients are of no use
 * there. Splitting them out keeps the application from paying for presentation
 * it never renders, which is also what keeps the entry inside its ceiling.
 */
function isPublicToken(name: string): boolean {
  return name.startsWith("public-") || name.startsWith("wg-");
}

/** Template highlights travel with the editor chunk, not the site entry. */
function isTemplateToken(name: string): boolean {
  return name.startsWith("template-");
}

function partition(entries: Record<string, string>, wanted: (name: string) => boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).filter(([name]) => wanted(name)));
}

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
  // Unchanged theme values inherit from :root; emit each shared value once.
  const darkOverrides = Object.fromEntries(
    Object.entries(themes.dark).filter(
      ([name, value]) => !isPublicToken(name) && value !== themes.light[name as keyof typeof themes.light],
    ),
  );
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

${block(
  partition(constants, (name) => !isPublicToken(name) && !isTemplateToken(name)),
  "    ",
)}

${block(density.comfortable, "    ")}

${block(
  partition(themes.light, (name) => !isPublicToken(name)),
  "    ",
)}
  }

  /* The un-stamped document is the common case: most viewers never choose a
     theme, so only prefers-color-scheme separates them. Guarding on
     :not([data-theme="light"]) lets an explicit light choice beat a dark OS. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
${block(darkOverrides, "      ")}
    }
  }

  /* Stamped explicitly, so the toggle also wins in the other direction. */
  :root[data-theme="dark"] {
${block(darkOverrides, "    ")}
  }

  [data-density="compact"] {
${block(density.compact, "    ")}
  }

  [data-radius="sharp"] {
${block(radiusModes.sharp, "    ")}
  }

  [data-radius="round"] {
${block(radiusModes.round, "    ")}
  }
}
`;
}

/**
 * The public site's own token sheet.
 *
 * Linked beside the entry stylesheet on public pages only. It declares the
 * same layer order so it can load in either order, and repeats the theme
 * structure the entry uses so a public token can differ per theme.
 */
export function emitPublicTokenCss(): string {
  const light = partition(themes.light, isPublicToken);
  const dark = partition(themes.dark, isPublicToken);
  return `/*
 * GENERATED FILE — do not edit.
 *
 * Source: assets/design/tokens.ts (tokens the public site alone reads)
 * Regenerate: pnpm run build:tokens
 */
@layer ${layers.join(", ")};

@layer tokens {
  :root {
${block(partition(constants, isPublicToken), "    ")}

${block(light, "    ")}
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
${block(dark, "      ")}
    }
  }

  :root[data-theme="dark"] {
${block(dark, "    ")}
  }
}
`;
}

/** The template palette is loaded only by source and visual template editors. */
export function emitTemplateTokenCss(): string {
  return `/* Generated from assets/design/tokens.ts. Regenerate: pnpm run build:tokens. */
@layer tokens {
  :root {
${block(partition(constants, isTemplateToken), "    ")}
  }
}
`;
}
