/**
 * Colour maths for verifying the tokens.
 *
 * The token module expresses several values as `color-mix(in oklab, …)`, which
 * a browser resolves but a test cannot read. Reproducing the mix here lets the
 * contrast of every derived pair be checked against the real numbers instead
 * of being asserted by eye — which matters most for the claim that
 * `--pk-accent-strong` carries white text across all thirteen accent hues.
 *
 * Implements the sRGB ↔ OKLab conversions from Björn Ottosson's definition and
 * the WCAG 2.1 relative-luminance formula.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return {
    r: Number.parseInt(full.slice(0, 2), 16) / 255,
    g: Number.parseInt(full.slice(2, 4), 16) / 255,
    b: Number.parseInt(full.slice(4, 6), 16) / 255,
  };
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, value));
}

interface Oklab {
  L: number;
  a: number;
  b: number;
}

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/**
 * `color-mix(in oklab, first <weight>%, second)` — the weight is how much of
 * the FIRST colour survives, matching the CSS argument order.
 */
export function mixOklab(first: string, weight: number, second: string): Rgb {
  const one = rgbToOklab(parseHex(first));
  const two = rgbToOklab(parseHex(second));
  const ratio = weight / 100;
  return oklabToRgb({
    L: one.L * ratio + two.L * (1 - ratio),
    a: one.a * ratio + two.a * (1 - ratio),
    b: one.b * ratio + two.b * (1 - ratio),
  });
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.1 contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  const brighter = Math.max(light, dark);
  const dimmer = Math.min(light, dark);
  return (brighter + 0.05) / (dimmer + 0.05);
}
