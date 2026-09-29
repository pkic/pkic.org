/**
 * One place renders a date, and it never writes "Invalid Date".
 *
 * Issue #19 reported a leadership card reading "In role since Invalid Date".
 * The missing start date was one cause; the other was that the surface built
 * the string itself — `new Date(value).toLocaleDateString(...)` — and
 * `Date.prototype.toLocaleDateString` has no answer for a value it cannot
 * parse except the words "Invalid Date". The shared module in
 * `assets/shared/format-date.ts` answers an em dash instead, follows the
 * viewer's own locale (issue #10), and keeps day-precise values on the UTC
 * calendar so they cannot shift a day west of Greenwich.
 *
 * The sweep for that class found three more copies of the same shape — a dead
 * `formatCalendarMonth`, the portal's event-day labels, and the public
 * `<time class="localTime">` script — so this gate keeps the count at one.
 *
 * Deliberately narrow: it forbids only the two APIs whose entire purpose is a
 * human-readable date or time string. `Intl.DateTimeFormat` is left alone
 * because it is also how a zone is resolved (`resolvedOptions().timeZone`),
 * how an IANA identifier is validated, and how a machine format for a `date`
 * or `time` input is produced — none of which is a rendering decision. There
 * is no allowlist: the one file below is the policy itself.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT, sourceLine } from "./helpers/source-files";

/** The module that owns displayed dates, and the only place these calls belong. */
const DATE_POLICY_MODULE = "assets/shared/format-date.ts";

const SCANNED_DIRECTORIES = ["assets", "functions", "scripts", "static"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];
const RENDERING_CALLS = /\.toLocale(?:Date|Time)String\s*\(/g;

/**
 * The options that ask for a reader-facing rendering rather than parts. A
 * surface spelling these is formatting a date for somebody to read, whichever
 * call it reaches for.
 */
const DISPLAY_OPTIONS = /\b(?:date|time)Style\s*:/g;

/**
 * A locale literal where the viewer's own should decide.
 *
 * Issue #10 reported dates reading month-first; the resolution, confirmed by
 * the user, is that a displayed date follows the viewer's own browser locale,
 * so every formatter in the policy module passes `undefined`. A literal such
 * as "en-US" or "en-GB" there would decide month-first or day-first for
 * everybody — which is the bug itself.
 */
const PINNED_LOCALE = /(?:toLocale(?:Date|Time)?String|new Intl\.DateTimeFormat)\s*\(\s*"([^"]+)"/g;

/**
 * Build output, not authored source. `static/js/built/` is the bundler's copy
 * of the very module that owns this policy (it is gitignored), so scanning it
 * reports the policy as its own violation.
 */
const GENERATED = new Set(["node_modules", "built"]);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (GENERATED.has(entry.name) || entry.name.startsWith(".")) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    if (!entry.isFile() || entry.name.startsWith("._")) return [];
    return SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

function renderingCallsOutsideThePolicy(): string[] {
  return SCANNED_DIRECTORIES.flatMap((directory) => listSourceFiles(join(REPOSITORY_ROOT, directory))).flatMap(
    (path) => {
      const relativePath = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
      if (relativePath === DATE_POLICY_MODULE) return [];
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(RENDERING_CALLS), ...source.matchAll(DISPLAY_OPTIONS)].map(
        (match) => `${relativePath}:${sourceLine(source, match.index)} ${match[0].trim()}`,
      );
    },
  );
}

describe("displayed dates", () => {
  it("are rendered only by the shared formatters, so an unreadable value is an em dash and never 'Invalid Date'", () => {
    expect(renderingCallsOutsideThePolicy()).toEqual([]);
  });

  it("never pin a locale in the policy module, so the viewer's own ordering wins", () => {
    const source = readFileSync(join(REPOSITORY_ROOT, DATE_POLICY_MODULE), "utf8");
    expect([...source.matchAll(PINNED_LOCALE)].map((match) => match[1])).toEqual([]);
  });

  it("would catch a surface that formatted a date itself", () => {
    // The gate is only worth having if it actually matches; assert the pattern
    // against the shape it exists to refuse rather than trusting an empty list.
    const offending = `new Date(value).toLocaleDateString(undefined, { month: "short" })`;
    expect(offending.match(RENDERING_CALLS)).not.toBeNull();
    expect(`Intl.DateTimeFormat().resolvedOptions().timeZone`.match(RENDERING_CALLS)).toBeNull();
    // The same for the two spellings folded in here, so neither passes as
    // "found nothing" when it has simply stopped matching.
    expect(`date.toLocaleString(undefined, { dateStyle: "medium" })`.match(DISPLAY_OPTIONS)).not.toBeNull();
    expect(`date.toLocaleString(undefined, { month: "short" })`.match(DISPLAY_OPTIONS)).toBeNull();
    expect(`date.toLocaleString("en-US", { month: "short" })`.match(PINNED_LOCALE)).not.toBeNull();
    expect(`date.toLocaleString(undefined, { month: "short" })`.match(PINNED_LOCALE)).toBeNull();
  });
});
