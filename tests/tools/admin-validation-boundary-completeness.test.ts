import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ADMIN_API_ROOT = join(REPOSITORY_ROOT, "functions/api/v1/admin");

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.startsWith("._") ? [path] : [];
  });
}

function matchingLocations(pattern: RegExp, includeAuth = true): string[] {
  return listTypeScriptFiles(ADMIN_API_ROOT).flatMap((path) => {
    const relativePath = relative(REPOSITORY_ROOT, path);
    if (!includeAuth && relativePath.startsWith("functions/api/v1/admin/auth/")) return [];

    const source = readFileSync(path, "utf8");
    return [...source.matchAll(pattern)].map(
      (match) => `${relativePath}:${source.slice(0, match.index).split("\n").length}`,
    );
  });
}

describe("admin request validation boundary completeness", () => {
  it("does not make mounted OpenAPI validation data optional", () => {
    const optionalValidatedData = /\b(?:data|validated)\s*\?\s*:\s*ValidatedData\b/g;
    const optionalValidatedAccess = /\b(?:data|validated)\?\.(?:body|params|query)\b/g;

    expect([...matchingLocations(optionalValidatedData), ...matchingLocations(optionalValidatedAccess)]).toEqual([]);
  });

  it("limits manual JSON parsing to the authentication bootstrap boundary", () => {
    expect(matchingLocations(/\bparseJsonBody\s*\(/g, false)).toEqual([]);
  });
});
