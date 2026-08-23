import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SERVICES_ROOT = join(REPOSITORY_ROOT, "functions/_lib/services");

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.startsWith("._") ? [path] : [];
  });
}

function anonymousListQueryContracts(): string[] {
  const declaration =
    /export\s+(?:async\s+)?function\s+(?:list|search)[A-Za-z0-9_]*\s*\([^)]*\b(?:params|query|filters)\s*:\s*\{/gs;
  const arrow =
    /export\s+const\s+(?:list|search)[A-Za-z0-9_]*\s*=\s*(?:async\s*)?\([^)]*\b(?:params|query|filters)\s*:\s*\{/gs;

  return listTypeScriptFiles(SERVICES_ROOT).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const matches = [...source.matchAll(declaration), ...source.matchAll(arrow)];
    return matches.map(
      (match) => `${relative(REPOSITORY_ROOT, path)}:${source.slice(0, match.index).split("\n").length}`,
    );
  });
}

describe("list query contract completeness", () => {
  it("derives exported list/search service inputs from named shared contracts", () => {
    expect(anonymousListQueryContracts()).toEqual([]);
  });
});
