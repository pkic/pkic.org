/**
 * The canonical design tokens.
 *
 * One definition, consumed everywhere: the portal imports this module, and
 * `scripts/build-design-tokens.mjs` emits the same values as CSS custom
 * properties for Hugo layouts, the Marp deck theme, and anything else that
 * only speaks CSS. Nothing else may declare a colour, a radius, a type size,
 * or a duration.
 *
 * Two rules make the rest of the system work:
 *
 *   1. Components read semantic names (`surface`, `ink`, `accent`), never
 *      palette names. The theme answers differently; the component does not
 *      know which theme it is in.
 *   2. The accent takes ONE input — the raw hue. Its strong/ink/soft/gradient
 *      variants derive from it, and derive differently per theme, so every
 *      accent stays legible on both grounds without a hand-kept lookup table.
 */

import { neutral, palette } from "./palette.ts";

/** Cascade layers, in order. `legacy` holds everything predating this system. */
export const layers = ["legacy", "tokens", "base", "components", "utilities"] as const;

export const prefix = "pk";

/** Surfaces, ink and lines — the only values that differ wholesale by theme. */
const surfacesLight = {
  canvas: "#f5f6f7",
  surface: neutral.white,
  "surface-sunk": neutral[100],
  "surface-raise": neutral.white,
  ink: neutral[800],
  "ink-muted": neutral[500],
  "ink-faint": "#868e96",
  "ink-inverse": neutral.white,
  line: neutral[300],
  "line-soft": neutral[200],
  "line-strong": neutral[400],
  overlay: "rgba(33, 37, 41, 0.45)",
} as const;

const surfacesDark: Record<keyof typeof surfacesLight, string> = {
  canvas: "#121417",
  surface: "#1a1e22",
  "surface-sunk": "#16191d",
  "surface-raise": "#22272c",
  ink: neutral[200],
  "ink-muted": "#9aa3ab",
  "ink-faint": neutral[500],
  "ink-inverse": "#10141a",
  line: "#2f353b",
  "line-soft": "#262b31",
  "line-strong": "#4a5259",
  overlay: "rgba(0, 0, 0, 0.62)",
};

/**
 * State tones are their own scale, never derived from the accent. On a
 * green-accented product that separation is not cosmetic: an accent-coloured
 * "success" makes a primary button and a healthy status indistinguishable.
 */
const statesLight = {
  ok: palette.green,
  "ok-ink": "#0f5132",
  "ok-soft": "#e8f3ed",
  warn: "#b3760a",
  "warn-ink": "#8a5a08",
  "warn-soft": "#fdf3e3",
  danger: palette.red,
  "danger-ink": "#a71d2a",
  "danger-soft": "#fbeaec",
  info: "#2b6cb0",
  "info-ink": "#1f4f83",
  "info-soft": "#e8f0f9",
} as const;

const statesDark: Record<keyof typeof statesLight, string> = {
  ok: "#3ec98c",
  "ok-ink": "#6fd8a4",
  "ok-soft": "#16281f",
  warn: "#e0a94f",
  "warn-ink": "#edc07a",
  "warn-soft": "#2a2415",
  danger: "#f0757f",
  "danger-ink": "#f59aa1",
  "danger-soft": "#2c191c",
  info: "#7cb0f5",
  "info-ink": "#a0c7f8",
  "info-soft": "#16202e",
};

/**
 * Accent derivations.
 *
 * The percentages are not chosen by eye. Yellow and purple differ enormously
 * in luminance, so a mix that darkens purple enough leaves yellow far too
 * bright — the first attempt here used 80%/92% and failed WCAG AA on four
 * hues in light and nine in dark. tests/frontend/design-contrast.test.ts
 * measures every derived pair against the real values; the ceilings it proves
 * are 67% for a fill carrying white text, 67% for ink on a light surface, and
 * 74% for ink on a dark one. These sit below those with margin.
 *
 * `accent-strong` uses the SAME mix in both themes: a filled control needs the
 * same contrast whichever theme the page is in.
 */
const accentLight = {
  "accent-strong": "color-mix(in oklab, var(--pk-accent) 62%, #000)",
  "accent-ink": "color-mix(in oklab, var(--pk-accent) 62%, #000)",
  "accent-soft": "color-mix(in oklab, var(--pk-accent) 12%, #fff)",
  "accent-deep": "color-mix(in oklab, var(--pk-accent) 72%, #000)",
  "accent-lift": "color-mix(in oklab, var(--pk-accent) 80%, #fff)",
  "grad-sheen": "linear-gradient(160deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 45%)",
} as const;

const accentDark: Record<keyof typeof accentLight, string> = {
  "accent-strong": "color-mix(in oklab, var(--pk-accent) 62%, #000)",
  "accent-ink": "color-mix(in oklab, var(--pk-accent) 70%, #fff)",
  "accent-soft": "color-mix(in oklab, var(--pk-accent) 20%, #000)",
  "accent-deep": "color-mix(in oklab, var(--pk-accent) 82%, #000)",
  "accent-lift": "color-mix(in oklab, var(--pk-accent) 62%, #fff)",
  "grad-sheen": "linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 45%)",
};

const shadowLight = {
  "shadow-1": "0 1px 2px rgba(16, 24, 32, 0.06)",
  "shadow-2": "0 2px 8px rgba(16, 24, 32, 0.08), 0 1px 2px rgba(16, 24, 32, 0.04)",
  "shadow-3": "0 12px 32px rgba(16, 24, 32, 0.14), 0 2px 8px rgba(16, 24, 32, 0.06)",
} as const;

const shadowDark: Record<keyof typeof shadowLight, string> = {
  "shadow-1": "0 1px 2px rgba(0,0,0,0.4)",
  "shadow-2": "0 2px 8px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3)",
  "shadow-3": "0 12px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
};

/** Values that do not change with the theme. */
export const constants = {
  font: '"Roboto", system-ui, -apple-system, sans-serif',
  "font-mono": '"Roboto Mono", ui-monospace, monospace',

  "text-2xs": "0.6875rem",
  "text-xs": "0.75rem",
  "text-sm": "0.8125rem",
  "text-md": "0.875rem",
  "text-lg": "1rem",
  "text-xl": "1.25rem",
  "text-2xl": "1.5rem",
  "text-3xl": "2rem",
  "tracking-label": "0.12em",

  "1": "0.25rem",
  "2": "0.5rem",
  "3": "0.75rem",
  "4": "1rem",
  "5": "1.5rem",
  "6": "2rem",
  "7": "3rem",
  "8": "4rem",

  "radius-sm": "4px",
  radius: "6px",
  "radius-lg": "10px",
  "radius-pill": "999px",

  "dur-fast": "120ms",
  dur: "220ms",
  "dur-slow": "520ms",
  ease: "cubic-bezier(0.16, 0.84, 0.28, 1)",

  // A spinner turns at its own pace, unrelated to a transition's duration.
  "dur-spin": "700ms",
  // A skeleton shimmer is slower than a spinner; it should read as waiting,
  // not as urgency.
  "dur-shimmer": "1400ms",
  // The reduced-motion clamp. Named rather than inlined so the one place that
  // is allowed to shorten motion is visible in the token list.
  "dur-instant": "1ms",

  focus: "0 0 0 2px var(--pk-surface), 0 0 0 4px var(--pk-accent)",

  // Text on any saturated solid fill — an accent button, a danger button.
  // Constant across themes: a filled control keeps its own contrast.
  "on-solid": "#ffffff",
  // The dark theme's --pk-danger is a light red meant for ink. Filling a
  // button with it and writing in white gave 2.6:1. A destructive fill gets
  // the same darkening an accent fill does.
  "danger-strong": "color-mix(in oklab, var(--pk-danger) 62%, #000)",
  "accent-on": "var(--pk-on-solid)",
  "grad-tonal": "linear-gradient(135deg, var(--pk-accent-deep), var(--pk-accent-lift))",
  "grad-duo": "linear-gradient(135deg, var(--pk-accent-deep) 0%, var(--pk-accent) 45%, var(--pk-accent-2) 100%)",
  "grad-brand": `linear-gradient(135deg, ${palette.green} 0%, ${palette.blue} 50%, ${palette.orange} 100%)`,
  stripe: `linear-gradient(90deg, ${palette.green} 0%, ${palette.blue} 50%, ${palette.orange} 100%)`,
} as const;

/**
 * Corner radius as a mode. Shape is one of the strongest signals of a product's
 * character, and it is the thing most likely to be retuned after seeing real
 * screens, so it is switchable rather than hard-coded into components.
 */
export const radiusModes = {
  sharp: { "radius-sm": "2px", radius: "3px", "radius-lg": "4px" },
  round: { "radius-sm": "8px", radius: "12px", "radius-lg": "18px" },
} as const;

/** Density is a surface decision, not a user preference, so it is a mode. */
export const density = {
  comfortable: {
    "control-y": "0.4rem",
    "control-x": "0.75rem",
    "row-y": "0.55rem",
    stack: "1rem",
  },
  compact: {
    "control-y": "0.25rem",
    "control-x": "0.6rem",
    "row-y": "0.32rem",
    stack: "0.75rem",
  },
} as const;

export const themes = {
  light: { ...surfacesLight, ...statesLight, ...accentLight, ...shadowLight },
  dark: { ...surfacesDark, ...statesDark, ...accentDark, ...shadowDark },
} as const;

export type ThemeName = keyof typeof themes;
export type ThemeTokens = (typeof themes)[ThemeName];

/** Every token a component may read, for the parity test and the generator. */
export function tokenNames(): string[] {
  return [
    ...Object.keys(themes.light),
    ...Object.keys(constants),
    ...Object.keys(density.comfortable),
    "accent",
    "accent-2",
  ].sort();
}

export function cssVar(name: string): string {
  return `--${prefix}-${name}`;
}
