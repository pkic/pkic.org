/**
 * The token module's invariants.
 *
 * These are the properties that make the system safe to build components
 * against: both themes define the same names, the accent derives rather than
 * being hand-listed per hue, state tones stay independent of the accent, and
 * no colour is defined only inside a theme-conditional block — the last one
 * being the bug that renders one theme's text on the other theme's ground.
 */

import { describe, expect, it } from "vitest";

import { emitTokenCss } from "../../assets/design/emit-css.ts";
import { accentNeighbour, isAccentHue, markArcs, palette } from "../../assets/design/palette.ts";
import { constants, cssVar, density, layers, themes, tokenNames } from "../../assets/design/tokens.ts";

describe("token module", () => {
  it("defines exactly the same names in both themes", () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it("gives every theme token a non-empty value", () => {
    for (const [theme, entries] of Object.entries(themes)) {
      for (const [name, value] of Object.entries(entries)) {
        expect(value, `${theme}.${name}`).toMatch(/\S/);
      }
    }
  });

  it("derives the accent from one input rather than listing it per hue", () => {
    for (const theme of Object.values(themes)) {
      for (const key of ["accent-strong", "accent-ink", "accent-soft"] as const) {
        expect(theme[key]).toContain("var(--pk-accent)");
      }
    }
  });

  it("keeps state tones independent of the accent", () => {
    for (const theme of Object.values(themes)) {
      for (const key of ["ok", "warn", "danger", "info"] as const) {
        expect(theme[key]).not.toContain("--pk-accent");
      }
    }
  });

  it("never lets a group accent be red, which belongs to destructive states", () => {
    expect(isAccentHue("red")).toBe(false);
    expect(Object.keys(accentNeighbour)).not.toContain("red");
  });

  it("points every accent at a hue that exists in the palette", () => {
    for (const [hue, neighbour] of Object.entries(accentNeighbour)) {
      expect(palette, hue).toHaveProperty(hue);
      expect(palette, neighbour).toHaveProperty(neighbour);
    }
  });

  it("builds the brand gradient from the mark's own arc colours, in order", () => {
    const expected = markArcs.map((hue) => palette[hue]);
    for (const value of expected) {
      expect(constants.stripe).toContain(value);
    }
    const positions = expected.map((value) => constants.stripe.indexOf(value));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("offers both densities the same knobs", () => {
    expect(Object.keys(density.compact).sort()).toEqual(Object.keys(density.comfortable).sort());
  });

  it("prefixes every token name", () => {
    for (const name of tokenNames()) {
      expect(cssVar(name)).toMatch(/^--pk-/);
    }
  });
});

describe("emitted stylesheet", () => {
  const css = emitTokenCss();

  it("declares the layer order before anything reads it", () => {
    expect(css.indexOf(`@layer ${layers.join(", ")};`)).toBeGreaterThanOrEqual(0);
    expect(css.indexOf("@layer tokens {")).toBeGreaterThan(css.indexOf(`@layer ${layers.join(", ")};`));
  });

  it("defines every theme token on bare :root, not only behind a theme guard", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf("@media"));
    for (const name of Object.keys(themes.light)) {
      expect(root, name).toContain(`${cssVar(name)}:`);
    }
  });

  it("guards the media query so an explicit light choice beats a dark system", () => {
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
  });

  it("redefines the dark palette for an explicit dark choice too", () => {
    expect(css).toContain(':root[data-theme="dark"]');
    const stamped = css.slice(css.indexOf(':root[data-theme="dark"]'));
    for (const name of Object.keys(themes.dark)) {
      expect(stamped, name).toContain(`${cssVar(name)}:`);
    }
  });

  it("is deterministic", () => {
    expect(emitTokenCss()).toBe(css);
  });
});
