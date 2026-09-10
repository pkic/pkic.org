/**
 * A picker searches as the reader types. It never asks them to press a button.
 *
 * Issue #26: assigning a chair had regressed to "type a name, press Search,
 * then choose from a list that appeared" — three deliberate acts where the
 * rest of the portal asks for one. The picker itself was fixed, but the fix
 * lives in a component's markup, which is exactly the kind of thing that comes
 * back the next time somebody adds a picker in a hurry.
 *
 * So the rule is stated about the whole class rather than about the one
 * component that broke: every module that renders the design system's popup
 * surface for choosing something must declare itself a type-ahead
 * (`aria-autocomplete="list"`, the input telling assistive technology that
 * matches appear as you type) and must render no button of its own — a picker
 * with a button in it is a picker that makes you press something.
 *
 * `ui/Menu.tsx` renders the same popup surface for a menu of commands rather
 * than for a search, so it is named here rather than filtered by a pattern
 * that would quietly stop covering a real picker.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "./helpers/source-files";

/** The shared popup surface. Rendering it is what makes a module a candidate. */
const POPUP_SURFACE = "pk-menu__popup";
/** Renders the surface for a menu of commands, not for choosing a search result. */
const COMMAND_MENU = "assets/ts/ui/Menu.tsx";

function listComponentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listComponentFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function pickerModules(): Array<{ path: string; source: string }> {
  return listComponentFiles(join(REPOSITORY_ROOT, "assets/ts"))
    .map((path) => ({
      path: relative(REPOSITORY_ROOT, path).replaceAll("\\", "/"),
      source: readFileSync(path, "utf8"),
    }))
    .filter(({ path, source }) => source.includes(POPUP_SURFACE) && path !== COMMAND_MENU);
}

describe("pickers", () => {
  it("exist — the discovery would otherwise pass by finding nothing", () => {
    expect(pickerModules().map(({ path }) => path).length).toBeGreaterThan(0);
  });

  it.each(pickerModules().map(({ path }) => path))("%s searches as the reader types", (path) => {
    const source = readFileSync(join(REPOSITORY_ROOT, path), "utf8");
    expect(source).toContain('aria-autocomplete="list"');
  });

  it.each(pickerModules().map(({ path }) => path))("%s offers no button to run its search", (path) => {
    const source = readFileSync(join(REPOSITORY_ROOT, path), "utf8");
    // Both the design system's `Button` and a bare element: a picker's matches
    // follow from typing, so neither has anything to do here.
    expect(source).not.toMatch(/<Button[\s>]/);
    expect(source).not.toMatch(/>\s*Search\s*</);
  });
});
