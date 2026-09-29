/**
 * A browser test uploads through the control a reader would use.
 *
 * Every upload here is a visible button beside a hidden `<input type="file">`.
 * A spec that calls `setInputFiles` on the input proves the input has a
 * listener; it proves nothing about whether the button reaches it. Issue #28
 * is what that gap costs — the headshot wiring swapped the input for a clone
 * and left the button pointing at an orphan, so no reader could upload a
 * photograph while both headshot specs kept passing.
 *
 * When it was found, three more specs were driving uploads the same way: two
 * logo tiles and the speaker's presentation, whose input is `pk-sr-only`, so
 * the spec was exercising something no sighted reader can touch.
 *
 * `helpers/file-upload.ts` clicks the control and answers the file chooser it
 * opens, which fails when the click reaches nothing. This keeps every spec on
 * that path.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SPEC_DIR = path.resolve("tests/e2e");

/** The helpers allowed to hand a file to an input, because they open it by click. */
const CHOOSER_HELPERS = new Set([
  path.join(SPEC_DIR, "helpers", "file-upload.ts"),
  path.join(SPEC_DIR, "helpers", "headshot-upload.ts"),
]);

function specFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return /\.(ts|mjs)$/.test(entry.name) ? [full] : [];
  });
}

describe("browser uploads", () => {
  it("go through the control, never straight at the hidden input", () => {
    const offenders = specFiles(SPEC_DIR)
      .filter((file) => !CHOOSER_HELPERS.has(file))
      .filter((file) => /\.setInputFiles\s*\(/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(".", file));

    expect(
      offenders,
      "reach the picker with `uploadThroughButton`/`uploadThroughControl`: setting files on the input cannot tell a working button from a dead one",
    ).toEqual([]);
  });

  it("would catch a spec that reached past the button", () => {
    // The gate is only worth having if the pattern still matches what it
    // exists to refuse.
    const bypass = `await page.locator('input[type="file"]').setInputFiles({ name: "x.svg" })`;
    expect(/\.setInputFiles\s*\(/.test(bypass)).toBe(true);
    const proper = `await uploadThroughButton(page, "Upload logo", file)`;
    expect(/\.setInputFiles\s*\(/.test(proper)).toBe(false);
  });
});
