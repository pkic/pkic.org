/**
 * Contrast of the token pairs, against the real values.
 *
 * The axe suite cannot do this: jsdom computes no layout and resolves no
 * custom properties, so it would be inventing every verdict. Here the
 * `color-mix(in oklab, …)` derivations are reproduced and measured, which is
 * the only way to check the claim the accent system rests on — that
 * `--pk-accent-strong` carries white text for every one of the thirteen hues,
 * with no per-hue lookup table.
 *
 * WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and UI boundaries.
 */

import { describe, expect, it } from "vitest";

import { contrastRatio, mixOklab, parseHex, type Rgb } from "../../assets/design/color";
import { accentNeighbour, palette, type AccentHue } from "../../assets/design/palette";
import { constants, themes, type ThemeName } from "../../assets/design/tokens";

const BODY_TEXT = 4.5;
const LARGE_TEXT = 3;

const ACCENTS = Object.keys(accentNeighbour) as AccentHue[];

/**
 * Reads the derivation out of the token module rather than restating it.
 *
 * An earlier version of this file hardcoded the percentages, so when the
 * module changed the test kept measuring the old values and kept failing
 * against a formula nobody was using. Parsing the declaration means the test
 * cannot drift from what actually ships.
 */
function derivedFrom(declaration: string, hue: string): Rgb {
  const match = /color-mix\(in oklab, var\(--pk-accent\) (\d+)%, (#[0-9a-fA-F]{3,6})\)/.exec(declaration);
  if (!match) throw new Error(`not an accent derivation: ${declaration}`);
  return mixOklab(hue, Number(match[1]), match[2]);
}

function derived(theme: ThemeName, token: "accent-strong" | "accent-ink" | "accent-soft", hue: AccentHue): Rgb {
  return derivedFrom(themes[theme][token], palette[hue]);
}

function ratio(foreground: string, background: string): number {
  return contrastRatio(parseHex(foreground), parseHex(background));
}

describe("accent derivation", () => {
  const onSolid = parseHex(constants["on-solid"]);

  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      const surface = parseHex(themes[theme].surface);

      it.each(ACCENTS)("%s: accent-strong carries white text", (hue) => {
        const strong = derived(theme, "accent-strong", hue);
        expect(contrastRatio(onSolid, strong)).toBeGreaterThanOrEqual(BODY_TEXT);
      });

      it.each(ACCENTS)("%s: accent-ink is readable on the surface", (hue) => {
        const ink = derived(theme, "accent-ink", hue);
        expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(BODY_TEXT);
      });

      it.each(ACCENTS)("%s: accent-ink is readable on accent-soft", (hue) => {
        const ink = derived(theme, "accent-ink", hue);
        const soft = derived(theme, "accent-soft", hue);
        expect(contrastRatio(ink, soft)).toBeGreaterThanOrEqual(BODY_TEXT);
      });
    });
  }
});

describe("surfaces and ink", () => {
  for (const theme of ["light", "dark"] as const) {
    const tokens = themes[theme];

    it(`${theme}: body ink on every surface`, () => {
      for (const surface of ["surface", "canvas", "surface-sunk", "surface-raise"] as const) {
        expect(ratio(tokens.ink, tokens[surface]), `ink on ${surface}`).toBeGreaterThanOrEqual(BODY_TEXT);
      }
    });

    it(`${theme}: muted ink stays body-legible on the surface`, () => {
      expect(ratio(tokens["ink-muted"], tokens.surface)).toBeGreaterThanOrEqual(BODY_TEXT);
    });

    it(`${theme}: faint ink clears the UI floor`, () => {
      // Reserved for placeholders, disabled affordances and dismiss glyphs.
      // It is deliberately NOT used for micro-labels: at 11px those are small
      // text by WCAG's definition and take --pk-ink-muted, which is held to
      // the body threshold above.
      expect(ratio(tokens["ink-faint"], tokens.surface)).toBeGreaterThanOrEqual(LARGE_TEXT);
    });
  }
});

describe("state tones", () => {
  for (const theme of ["light", "dark"] as const) {
    const tokens = themes[theme];

    it.each(["ok", "warn", "danger", "info"] as const)(`${theme}: %s ink on its own soft ground`, (tone) => {
      expect(ratio(tokens[`${tone}-ink`], tokens[`${tone}-soft`])).toBeGreaterThanOrEqual(BODY_TEXT);
    });

    it.each(["ok", "warn", "danger", "info"] as const)(`${theme}: %s ink on the surface`, (tone) => {
      expect(ratio(tokens[`${tone}-ink`], tokens.surface)).toBeGreaterThanOrEqual(BODY_TEXT);
    });

    it(`${theme}: the danger fill carries white text`, () => {
      // .pk-btn--danger fills with --pk-danger and writes in --pk-on-solid.
      const strong = /color-mix\(in oklab, var\(--pk-danger\) (\d+)%, (#[0-9a-fA-F]{3,6})\)/.exec(
        constants["danger-strong"],
      );
      if (!strong) throw new Error("danger-strong is no longer a mix");
      const fill = mixOklab(tokens.danger, Number(strong[1]), strong[2]);
      expect(contrastRatio(parseHex(constants["on-solid"]), fill)).toBeGreaterThanOrEqual(BODY_TEXT);
    });
  }
});

describe("the colour maths itself", () => {
  it("agrees with the reference values for black on white", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("round-trips a colour through oklab", () => {
    const mixed = mixOklab("#198754", 100, "#ffffff");
    const original = parseHex("#198754");
    expect(mixed.r).toBeCloseTo(original.r, 2);
    expect(mixed.g).toBeCloseTo(original.g, 2);
    expect(mixed.b).toBeCloseTo(original.b, 2);
  });
});
