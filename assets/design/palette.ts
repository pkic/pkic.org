/**
 * The PKI Consortium palette.
 *
 * These are the organization's colours as they already exist in the slide
 * theme, the public site's section map, and `_theme-and-bootstrap.scss`. They
 * are raw values with no meaning attached: nothing in a component may read
 * them. Components read the semantic tokens in `tokens.ts`, which are defined
 * in terms of these.
 *
 * The three arc colours are the mark's own: `logo-icon-color.svg` fills its
 * segments green, orange and blue, which is why the brand gradient runs in
 * that order — it is the mark unrolled.
 */

export const palette = {
  green: "#198754",
  emerald: "#28a745",
  teal: "#20c997",
  cyan: "#17a2b8",
  blue: "#5a9bd5",
  indigo: "#667eea",
  purple: "#6f42c1",
  violet: "#9c27b0",
  rose: "#e91e63",
  red: "#dc3545",
  coral: "#ff7f50",
  orange: "#ed7d31",
  amber: "#ffc107",
  yellow: "#ffc000",
} as const;

export type PaletteHue = keyof typeof palette;

/** Neutrals, carried over unchanged so legacy and new surfaces agree. */
export const neutral = {
  100: "#f8f9fa",
  200: "#e9ecef",
  300: "#dee2e6",
  400: "#adb5bd",
  500: "#6c757d",
  600: "#495057",
  700: "#343a40",
  800: "#212529",
  900: "#0d1b2a",
  black: "#060606",
  white: "#ffffff",
} as const;

/**
 * The mark's three arcs, in the order they appear around it. The brand
 * gradient is exactly this sequence, which is why a gradient bar and the mark
 * read as the same object rather than two brand devices.
 */
export const markArcs = ["green", "blue", "orange"] as const satisfies readonly PaletteHue[];

/**
 * A group's accent and the neighbour used for its duo gradient. Ordered around
 * the hue wheel so a duo gradient never crosses the wheel and turns muddy.
 *
 * Red is deliberately absent as an accent: it stays reserved for destructive
 * and error states, so no group's colour can read as a warning.
 */
export const accentNeighbour: Readonly<Record<Exclude<PaletteHue, "red">, PaletteHue>> = {
  green: "teal",
  emerald: "blue",
  teal: "cyan",
  cyan: "blue",
  blue: "indigo",
  indigo: "purple",
  purple: "violet",
  violet: "rose",
  rose: "red",
  coral: "orange",
  orange: "amber",
  amber: "yellow",
  yellow: "amber",
};

export type AccentHue = keyof typeof accentNeighbour;

export function isAccentHue(value: string): value is AccentHue {
  return Object.prototype.hasOwnProperty.call(accentNeighbour, value);
}
