import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BADGE_GENERIC_BRAND_ASSETS,
  BADGE_GENERIC_BRAND_PROVENANCE,
  BADGE_GENERIC_FONT_CSS,
  BADGE_GENERIC_FONT_LICENSE,
} from "../../assets/shared/badge-generic-template-assets";

describe("canonical public badge artwork snapshot provenance", () => {
  it("requires regeneration whenever an authoritative mark or bundled font changes", () => {
    for (const source of Object.values(BADGE_GENERIC_BRAND_PROVENANCE)) {
      const bytes = readFileSync(resolve(process.cwd(), source.path));
      expect(createHash("sha256").update(bytes).digest("hex"), source.path).toBe(source.sha256);
    }
  });
  it("embeds the exact existing font bytes and carries their license instead of fetching a new font", () => {
    for (const key of ["roboto_latin", "roboto_latin_ext"] as const) {
      const original = readFileSync(resolve(process.cwd(), BADGE_GENERIC_BRAND_PROVENANCE[key].path));
      expect(Buffer.from(BADGE_GENERIC_BRAND_ASSETS[key].base64, "base64")).toEqual(original);
    }
    expect(BADGE_GENERIC_FONT_LICENSE).toBe(
      readFileSync(resolve(process.cwd(), "static/fonts/Roboto-OFL.txt"), "utf8"),
    );
  });
  it("keeps the authored mark path geometry while replacing its fixed fill classes with local attributes", () => {
    const original = readFileSync(resolve(process.cwd(), BADGE_GENERIC_BRAND_PROVENANCE.mark.path), "utf8");
    const snapshot = Buffer.from(BADGE_GENERIC_BRAND_ASSETS.mark.base64, "base64").toString("utf8");
    const paths = (source: string) => [...source.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]);
    expect(paths(snapshot)).toEqual(paths(original));
    expect(snapshot).not.toMatch(/<style|\bclass=|\bstyle=/);
    for (const fill of ["#5a9bd5", "#ed7d31", "#188754", "#000"]) expect(snapshot).toContain(`fill="${fill}"`);
  });
  it("uses the authoritative font-face declarations and Unicode coverage", () => {
    const original = readFileSync(resolve(process.cwd(), "assets/design/fonts.css"), "utf8");
    const expected = original
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim()
      .replace("/fonts/Roboto-latin.woff2", "asset:roboto_latin")
      .replace("/fonts/Roboto-latin-ext.woff2", "asset:roboto_latin_ext");
    expect(BADGE_GENERIC_FONT_CSS).toBe(expected);
  });
});
