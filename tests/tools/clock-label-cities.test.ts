/**
 * Every event names its own clock; no source spells a city into a clock label.
 *
 * Times on an event's clock read "09:00 Austin time" for an Austin event on
 * `America/Chicago`, because `formatClockName` takes the city from the event's
 * location and falls back to the zone's own city only when there is none. A
 * literal such as "Amsterdam time" in a component would name one city for every
 * event — the defect this guards against — so clock labels are built by the
 * shared formatters alone.
 *
 * The scan reads string and JSX text only (comments may carry examples), in the
 * authored sources that render pages: `assets`, `functions` and `site`. Tests
 * and fixtures are not scanned; they pin labels on purpose.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT, sourceLine } from "./helpers/source-files";

const SCANNED_DIRECTORIES = ["assets", "functions", "site"];
const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
};
const GENERATED = new Set(["node_modules", "built", "dist", "fixtures"]);

/** Every city an IANA zone is named by, as the zone picker spells it. */
const ZONE_CITIES = [
  ...new Set(
    Intl.supportedValuesOf("timeZone")
      .map((zone) => zone.split("/").pop()!.replaceAll("_", " "))
      .filter((city) => /^[A-Z][a-z]/u.test(city)),
  ),
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const CITY_CLOCK_LABEL = new RegExp(`\\b(?:${ZONE_CITIES.map(escape).join("|")})\\s+time\\b`, "gu");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (GENERATED.has(entry.name) || entry.name.startsWith(".")) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    if (!entry.isFile() || entry.name.startsWith("._")) return [];
    return Object.keys(SCRIPT_KINDS).some((extension) => entry.name.endsWith(extension)) ||
      entry.name.endsWith(".astro")
      ? [path]
      : [];
  });
}

/** String literals, template parts and JSX text, with their offsets; comments never appear here. */
function scriptText(source: string, path: string): Array<{ text: string; offset: number }> {
  const kind = SCRIPT_KINDS[Object.keys(SCRIPT_KINDS).find((extension) => path.endsWith(extension)) ?? ".ts"]!;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const found: Array<{ text: string; offset: number }> = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    )
      found.push({ text: node.text, offset: node.getStart(file) });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** An Astro page's frontmatter and markup with comments blanked, keeping offsets. */
function astroText(source: string): Array<{ text: string; offset: number }> {
  const blank = (match: string) => match.replace(/[^\n]/gu, " ");
  return [
    {
      text: source
        .replace(/<!--[\s\S]*?-->/gu, blank)
        .replace(/\/\*[\s\S]*?\*\//gu, blank)
        .replace(/(^|[^:])\/\/[^\n]*/gu, blank),
      offset: 0,
    },
  ];
}

function hardcodedClockCities(path: string, source: string): string[] {
  const parts = path.endsWith(".astro") ? astroText(source) : scriptText(source, path);
  return parts.flatMap(({ text, offset }) =>
    [...text.matchAll(CITY_CLOCK_LABEL)].map(
      (match) => `${sourceLine(source, offset + (path.endsWith(".astro") ? match.index : 0))} ${match[0]}`,
    ),
  );
}

describe("event clock labels", () => {
  it("never hardcode a city outside tests and fixtures", () => {
    const findings = SCANNED_DIRECTORIES.flatMap((directory) =>
      listSourceFiles(join(REPOSITORY_ROOT, directory)).flatMap((path) =>
        hardcodedClockCities(path, readFileSync(path, "utf8")).map(
          (finding) => `${relative(REPOSITORY_ROOT, path).replaceAll("\\", "/")}:${finding}`,
        ),
      ),
    );
    expect(findings).toEqual([]);
  });

  it("flags a city spelled into a label but not one in a comment or a zone identifier", () => {
    expect(hardcodedClockCities("label.tsx", "export const a = <p>Times are Amsterdam time.</p>;")).toEqual([
      "1 Amsterdam time",
    ]);
    expect(hardcodedClockCities("label.ts", "const b = `${clock} Chicago time`;")).toEqual(["1 Chicago time"]);
    expect(
      hardcodedClockCities(
        "label.ts",
        '/** "09:00 Amsterdam time" */\nconst zone = "Europe/Amsterdam";\nconst label = formatClockName(zone);',
      ),
    ).toEqual([]);
    expect(hardcodedClockCities("page.astro", "<!-- Austin time -->\n<p>New York time</p>")).toEqual([
      "2 New York time",
    ]);
  });
});
