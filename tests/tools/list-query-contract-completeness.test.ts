import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTypeScriptFiles, readTypeScriptSource, REPOSITORY_ROOT, sourceLine } from "./helpers/source-files";

const SERVICES_ROOT = join(REPOSITORY_ROOT, "functions/_lib/services");

function anonymousListQueryContracts(): string[] {
  const declaration =
    /export\s+(?:async\s+)?function\s+(?:list|search)[A-Za-z0-9_]*\s*\([^)]*\b(?:params|query|filters)\s*:\s*\{/gs;
  const arrow =
    /export\s+const\s+(?:list|search)[A-Za-z0-9_]*\s*=\s*(?:async\s*)?\([^)]*\b(?:params|query|filters)\s*:\s*\{/gs;

  return listTypeScriptFiles(SERVICES_ROOT).flatMap((path) => {
    const source = readTypeScriptSource(path);
    const matches = [...source.matchAll(declaration), ...source.matchAll(arrow)];
    return matches.map((match) => `${relative(REPOSITORY_ROOT, path)}:${sourceLine(source, match.index)}`);
  });
}

describe("list query contract completeness", () => {
  it("derives exported list/search service inputs from named shared contracts", () => {
    expect(anonymousListQueryContracts()).toEqual([]);
  });
});
