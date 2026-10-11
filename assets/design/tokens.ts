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
  "page-surface": neutral.white,
  surface: neutral.white,
  "control-surface": neutral.white,
  "logo-surface": neutral.white,
  "member-logo-filter": "grayscale(1)",
  "member-logo-hover-filter": "none",
  "member-logo-blend": "multiply",
  "surface-sunk": neutral[100],
  "surface-raise": neutral.white,
  ink: neutral[800],
  "ink-muted": "#626c74",
  "ink-faint": "#868e96",
  "ink-inverse": neutral.white,
  line: neutral[300],
  "line-soft": neutral[200],
  "line-strong": neutral[400],
  overlay: "rgba(33, 37, 41, 0.45)",
} as const;

const surfacesDark: Record<keyof typeof surfacesLight, string> = {
  canvas: "#0c1114",
  "page-surface": "#12181c",
  surface: "#1b2429",
  "control-surface": "#26333a",
  "logo-surface": "#e0e4e8",
  "member-logo-filter": "grayscale(1) invert(1)",
  "member-logo-hover-filter": "grayscale(1) invert(1)",
  "member-logo-blend": "screen",
  "surface-sunk": "#151e23",
  "surface-raise": "#243038",
  ink: "#eef3f2",
  "ink-muted": "#b5c3c3",
  "ink-faint": "#8fa1a3",
  "ink-inverse": "#10141a",
  line: "#3b4b52",
  "line-soft": "#2b3940",
  "line-strong": "#6c8088",
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
  // Decorative Handlebars backgrounds keep the editor's ordinary ink readable.
  "template-preview-surface": neutral.white,
  "template-insertion-highlight": "rgba(255, 165, 0, 0.2)",
  "template-variable-highlight": "rgba(8, 145, 178, 0.15)",
  "template-block-highlight-0": "rgba(13, 110, 253, 0.15)",
  "template-block-highlight-1": "rgba(25, 135, 84, 0.15)",
  "template-block-highlight-2": "rgba(253, 126, 20, 0.15)",
  "template-block-highlight-3": "rgba(111, 66, 193, 0.15)",
  "template-block-highlight-4": "rgba(214, 51, 132, 0.15)",
  "template-block-highlight-5": "rgba(32, 201, 151, 0.15)",
  "template-block-highlight-6": "rgba(220, 53, 69, 0.15)",
  "template-block-highlight-7": "rgba(13, 202, 240, 0.15)",

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
  "text-display": "clamp(2.25rem, 5vw, 3.5rem)",
  "text-display-lg": "clamp(2.6rem, 5vw, 3.5rem)",
  "text-display-mobile": "clamp(2rem, 10vw, 2.7rem)",
  "tracking-label": "0.12em",

  /*
   * Public-site sizes.
   *
   * The published site needs a fluid home headline, a statistics figure, a
   * working-group page title and a large card icon; none of them exist on the
   * application scale. Everything else the public site needs is already a step
   * on the shared ramp and reads it directly rather than adding a near
   * duplicate here.
   */
  "public-text-hero": "clamp(1.6rem, 5.5vw, 3.5rem)",
  "public-text-stat": "1.6rem",
  "public-text-wg-title": "2rem",
  "public-text-card-icon": "2.25rem",
  "public-radius-card-lg": "1.5rem",

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
  "radius-card": "1rem",
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
  chrome: "#050505",
  "chrome-deep": "#020202",
  "chrome-panel": "#080808",
  "chrome-raised": "#111111",
  /*
   * Controls sitting ON such a fill, rather than text written on it.
   *
   * A CTA banner paints its own saturated ground — a blue block, a green
   * band — and the page accent has nothing to do with that ground: an accent
   * fill inside one reads as a second, competing color, and in the dark theme
   * the quiet button's surface arrives near-black on it. So on that ground the
   * filled control becomes the white one and takes its ink from the ground it
   * covers, and the quiet one becomes a full-strength white outline over that
   * same ground — a softened outline cannot reach a 3:1 boundary against the
   * lighter banner colors, where white itself only just does. The ink is
   * constant across themes, because the banner's ground is.
   */
  "on-solid-ink": neutral[800],
  "public-prose-callout": "#111827",
  "public-home-feature-ink": "#cde8d8",
  /* The near-black a working-group header fades into, and the shade its
     accent is darkened against. Both are ground, not ink, so they hold
     across themes. */
  "public-wg-header-ground": "#0d0d0d",
  "public-wg-shade": "#000000",
  "public-hero-action": `color-mix(in srgb, ${palette.orange} 75%, #000)`,
  /* Working-group accents, one per `color` value a group declares. */
  "wg-green": "rgb(25, 135, 84)",
  "wg-blue": "rgb(90, 155, 213)",
  "wg-orange": "rgb(237, 125, 49)",
  "wg-purple": "rgb(111, 66, 193)",
  "wg-teal": "rgb(32, 201, 151)",
  "public-hero": "linear-gradient(135deg, #0a1f14 0%, #0d3d24 55%, #0a2f40 100%)",
  "public-hero-home": "linear-gradient(135deg, #0a1f14 0%, #0d3d24 45%, #0a2f40 100%)",
  "public-hero-blog": "linear-gradient(135deg, #0c0e2a 0%, #142058 50%, #0a183a 100%)",
  "public-hero-members": "linear-gradient(135deg, #10082a 0%, #200d42 50%, #0c0820 100%)",
  "public-hero-about": "linear-gradient(135deg, #0a0c20 0%, #141c3a 50%, #0a1428 100%)",
  "public-hero-events": "linear-gradient(135deg, #1a0a04 0%, #38200a 50%, #1a1408 100%)",
  "public-hero-resources": "linear-gradient(135deg, #041a18 0%, #083430 50%, #041a24 100%)",
  "public-hero-working-groups": "linear-gradient(135deg, #062719 0%, #0b4a2c 48%, #093849 100%)",
  /* Page hero themes, chosen by a page's own `color`. */
  "public-hero-blue": "linear-gradient(135deg, #08152e 0%, #0d2452 55%, #081a38 100%)",
  "public-hero-green": "linear-gradient(135deg, #0a1f14 0%, #0d3d24 55%, #0a2f14 100%)",
  "public-hero-orange": "linear-gradient(135deg, #1e0c05 0%, #3d1a08 55%, #2a140a 100%)",
  "public-hero-purple": "linear-gradient(135deg, #110820 0%, #2a0d3d 55%, #1a0c2a 100%)",
  "public-hero-teal": "linear-gradient(135deg, #041a18 0%, #083430 55%, #04201f 100%)",
  "public-card-1": "linear-gradient(135deg, #073922 0%, #0b5041 52%, #122139 100%)",
  "public-card-2": "linear-gradient(135deg, #071c35 0%, #163e4a 52%, #0b2f2a 100%)",
  "public-card-3": "linear-gradient(135deg, #2a0d3d 0%, #173b42 52%, #0d3d24 100%)",
  "public-card-4": "linear-gradient(135deg, #3d1a08 0%, #572119 52%, #29102d 100%)",
  "public-card-5": "linear-gradient(135deg, #381020 0%, #301447 52%, #142058 100%)",
  "public-card-6": "linear-gradient(135deg, #0d3d24 0%, #3d2c08 100%)",
  "public-card-shade": "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.24) 64%, rgba(0,0,0,0.08) 100%)",
  "public-hero-image-scrim": "linear-gradient(180deg, rgba(0,0,0,0.22), rgba(0,0,0,0.62))",
  "public-hero-sponsor-scrim": "rgba(0,0,0,0.42)",
  "public-wg-1": "linear-gradient(135deg, #34115f, #792fc3)",
  "public-wg-pkimm": "linear-gradient(135deg, #1e3a5f, #0d2040)",
  "public-wg-pqc": "linear-gradient(135deg, #4a1d8e, #1c0852)",
  "public-wg-cm": "linear-gradient(135deg, #8b3200, #4a1a00)",
  "public-wg-tc": "linear-gradient(135deg, #1a5a3a, #0a2d1e)",
  "public-wg-cbom": "linear-gradient(135deg, #006a6a, #003333)",
  "public-wg-radius": "0.875rem",
  "public-wg-label-text": "0.65rem",
  "public-wg-heading-text": "1.1rem",
  "public-wg-body-text": "0.83rem",
  "public-wg-chip-text": "0.72rem",
  "public-wg-label-ink": "rgba(255,255,255,0.55)",
  "public-wg-icon-ink": "rgba(255,255,255,0.88)",
  "public-wg-circle-strong": "rgba(255,255,255,0.07)",
  "public-wg-circle-soft": "rgba(255,255,255,0.05)",
  "public-wg-chip-muted": "rgba(0,0,0,0.055)",
  "public-wg-chip-muted-hover": "rgba(0,0,0,0.11)",
  "public-wg-shadow": "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.07)",
  "public-wg-shadow-hover": "0 4px 8px rgba(0,0,0,0.08), 0 16px 48px rgba(0,0,0,0.14)",
  "public-support": "linear-gradient(135deg, #0a1f14 0%, #0d3d24 45%, #0a2f40 100%)",
  "public-support-stripe": `linear-gradient(to right, ${palette.green}, ${palette.teal}, ${palette.blue}, ${palette.yellow}, ${palette.orange}, ${palette.red})`,
  "public-support-stat": palette.teal,
  "public-support-heading": "#cde8d8",
  "public-support-body": "rgba(255,255,255,0.7)",
  "public-support-label": "rgba(255,255,255,0.55)",
  "public-support-link": "rgba(255,255,255,0.6)",
  "public-support-circle": "rgba(255,255,255,0.05)",
  "public-support-circle-soft": "rgba(255,255,255,0.035)",
  "public-support-stat-text": "2.75rem",
  "public-support-body-text": "0.9rem",
  "public-support-link-text": "0.875rem",
  "public-support-label-text": "0.75rem",
  "public-support-button-text": "0.95rem",
  "public-support-shadow": "0 4px 12px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.12)",
  "public-member-wall-duration": "30s",
  "public-member-wall-mask": "linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%)",
  "agenda-location-1": "#2f8fcb",
  "agenda-location-2": "#f2782c",
  "agenda-location-3": "#df3447",
  "agenda-location-4": "#6c36bd",
  "agenda-location-5": "#10a884",
  "agenda-location-6": "#5c76d8",
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
