import { describe, expect, it } from "vitest";
import { copyTermFindings } from "../../scripts/check-copy-terms.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

describe("copy terms gate", () => {
  it("checks new files while ignoring tracked paths deleted during a move", () => {
    const cwd = mkdtempSync(join(tmpdir(), "copy-terms-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd });
      mkdirSync(join(cwd, "assets"));
      const old = join(cwd, "assets/old.ts");
      writeFileSync(old, 'export const color = "green";');
      execFileSync("git", ["add", "assets/old.ts"], { cwd });
      rmSync(old);
      const script = fileURLToPath(new URL("../../scripts/check-copy-terms.mjs", import.meta.url));
      expect(spawnSync(process.execPath, [script], { cwd, encoding: "utf8" }).status).toBe(0);
      writeFileSync(join(cwd, "assets/new.ts"), 'export const colour = "green";');
      const result = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("assets/new.ts:1");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("flags British spellings and vendor names", () => {
    expect(copyTermFindings("Pick a colour for the centre panel")).toEqual([{ rule: "US English", term: "colour" }]);
    expect(copyTermFindings("Open the OBS scene")).toEqual([{ rule: "vendor-neutral production", term: "OBS" }]);
    expect(copyTermFindings("Load it in vMix")).toHaveLength(1);
  });

  it("allows the platform's labelledby and ordinary words", () => {
    expect(copyTermFindings('<div aria-labelledby="title" labelledBy={id}>')).toEqual([]);
    expect(copyTermFindings("observe the jobs; color, center, program, catalog, labeled")).toEqual([]);
    expect(copyTermFindings("recentResult, liveProgramMessageSchema, a programmer, an organism, analysis")).toEqual([]);
  });

  it("flags British spellings inside identifiers", () => {
    expect(copyTermFindings("const PAGE_COLOURS = pageColours;")).toEqual([{ rule: "US English", term: "COLOUR" }]);
    expect(copyTermFindings("catalogueQuery")).toEqual([{ rule: "US English", term: "catalogue" }]);
    expect(copyTermFindings("the Programme committee")).toHaveLength(1);
  });
});
