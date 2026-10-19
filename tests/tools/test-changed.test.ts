import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { changedTestArgs, SUITE_CONFIGS } from "../../scripts/test-changed.mjs";

describe("pnpm test:changed", () => {
  it("covers every Vitest suite that pnpm test runs", () => {
    const scripts = z.record(z.string(), z.string()).parse(JSON.parse(readFileSync("package.json", "utf8")).scripts);
    const suites =
      z
        .string()
        .parse(scripts.test)
        .match(/test:\w+/g) ?? [];
    const configs = suites.map((suite) => /--config (\S+)/.exec(scripts[suite] ?? "")?.[1]);
    expect([...SUITE_CONFIGS].sort()).toEqual(configs.sort());
  });

  it("selects uncommitted changes by default and a ref with --since", () => {
    expect(changedTestArgs("vitest.config.ts", [])).toContain("--changed");
    const args = changedTestArgs("vitest.config.ts", ["--since", "pr-head/main", "--reporter", "dot"]);
    expect(args).toContain("--changed=pr-head/main");
    expect(args).not.toContain("--since");
    expect(args.slice(-2)).toEqual(["--reporter", "dot"]);
    expect(() => changedTestArgs("vitest.config.ts", ["--since"])).toThrow("--since <ref>");
  });
});
