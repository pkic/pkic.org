import { describe, expect, it } from "vitest";
import {
  BADGE_TEXT_FIT_CHARACTER_EM,
  badgeTextFitFontSize,
  badgeTextFitProperties,
} from "../../assets/shared/badge-template-text-fit";

/** Resolve the CSS expression for given counts as the browser does: millimeters, min(), max(), calc() arithmetic. */
function resolve(css: string, longest: number, length: number): number {
  const tokens = css
    .replace(/var\(--badge-[a-z-]+-longest,1\)/g, String(longest))
    .replace(/var\(--badge-[a-z-]+-length,1\)/g, String(length))
    .replace(/mm/g, "")
    .match(/min|max|calc|\d+(?:\.\d+)?|[(),*/+-]/g)!;
  let index = 0;
  const take = (expected?: string) => {
    const token = tokens[index++];
    if (expected && token !== expected) throw new Error(`Expected ${expected}, found ${token}`);
    return token;
  };
  function primary(): number {
    const token = take();
    if (token === "(" || token === "calc") {
      if (token === "calc") take("(");
      const value = sum();
      take(")");
      return value;
    }
    if (token === "min" || token === "max") {
      take("(");
      const values = [sum()];
      while (tokens[index] === ",") values.push((take(), sum()));
      take(")");
      return token === "min" ? Math.min(...values) : Math.max(...values);
    }
    return Number(token);
  }
  function product(): number {
    let value = primary();
    while (tokens[index] === "*" || tokens[index] === "/")
      value = take() === "*" ? value * primary() : value / primary();
    return value;
  }
  function sum(): number {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-")
      value = take() === "+" ? value + product() : value - product();
    return value;
  }
  const value = sum();
  expect(index).toBe(tokens.length);
  return value;
}

describe("badge attendee text fit", () => {
  it("measures each attendee field's longest word and length without carrying the text itself", () => {
    const properties = badgeTextFitProperties({
      firstName: "Paul",
      lastName: "van Brouwershaven",
      displayName: "Paul van Brouwershaven",
      organization: "",
      jobTitle: "Cryptography Policy Advisor",
    });
    expect(properties).toBe(
      "--badge-first-name-longest:4;--badge-first-name-length:4;--badge-last-name-longest:13;--badge-last-name-length:17;--badge-display-name-longest:13;--badge-display-name-length:22;--badge-organization-longest:1;--badge-organization-length:1;--badge-job-title-longest:12;--badge-job-title-length:27",
    );
  });

  it.each([
    ["Brouwershaven", 13, 17, "regular", 7.5, 3.5],
    ["Wolfeschlegelsteinhausen", 24, 24, "regular", 7.5, 3.5],
    ["Maximiliana", 11, 11, "bold", 11.5, 5],
    ["Femke", 5, 5, "bold", 11.5, 5],
  ] as const)("sizes %s so its longest word fits a 48 mm column", (_, longest, length, weight, maxMm, minMm) => {
    const css = badgeTextFitFontSize({ field: "lastName", widthMm: 48, maxMm, minMm, weight });
    const size = resolve(css, longest, length);
    expect(size).toBeGreaterThanOrEqual(minMm);
    expect(size).toBeLessThanOrEqual(maxMm);
    expect(longest * BADGE_TEXT_FIT_CHARACTER_EM[weight] * size).toBeLessThanOrEqual(48 + 1e-9);
  });

  it("lets a long job title take two lines before shrinking below its floor", () => {
    const css = badgeTextFitFontSize({
      field: "jobTitle",
      widthMm: 53,
      maxMm: 4,
      minMm: 2.8,
      weight: "bold",
      lines: 2,
    });
    expect(resolve(css, 12, 27)).toBe(4);
    expect(resolve(css, 14, 70)).toBe(3);
  });

  it("keeps short names at the designed size and shrinks a long one-line value only to its floor", () => {
    const css = badgeTextFitFontSize({ field: "displayName", widthMm: 89, maxMm: 8, minMm: 4, weight: "bold" });
    expect(resolve(css, 5, 15)).toBe(8);
    expect(resolve(css, 13, 22)).toBeCloseTo(89 / (22 * 0.62), 5);
    expect(resolve(css, 8, 60)).toBe(6);
  });
});
