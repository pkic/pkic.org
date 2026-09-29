/**
 * The gate under issue #15.
 *
 * A member page's address is `/members/keyfactor/` only if the row carries a
 * slug. Two of the three writers of `organizations` set one; the third — the
 * local/preview seed — did not, so every seeded member landed back on
 * `/members/profile/?id=<uuid>`, which is exactly the address the issue is
 * about. Nothing said so: the column is nullable by necessity (individuals
 * have no organization row at all), so a missing slug is silent.
 *
 * This makes it loud. Any statement in shipped code that creates an
 * organization has to name the `slug` column.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SEARCH_ROOTS = ["functions", "scripts", "migrations"];

/** `INSERT INTO organizations ( … )` and the column list it opens with. */
const ORGANIZATION_INSERT = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+organizations\s*\(([^)]*)\)/gis;

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|mjs|js|sql)$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of SEARCH_ROOTS) walk(path.join(ROOT, root));
  return found;
}

describe("every writer of an organization gives it a public address", () => {
  const files = sourceFiles();

  it("reads the source it is meant to be guarding", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("names the slug column in every organization insert", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(ORGANIZATION_INSERT)) {
        const columns = match[1]
          .split(",")
          .map((column) => column.trim().toLowerCase())
          .filter(Boolean);
        if (!columns.includes("slug")) {
          offenders.push(`${path.relative(ROOT, file)}: (${columns.join(", ")})`);
        }
      }
    }
    // Test fixtures are deliberately outside this walk: a fixture that omits
    // the slug is exercising the id-keyed fallback, which is a real state for
    // an individual member and has to stay testable.
    expect(offenders).toEqual([]);
  });
});
