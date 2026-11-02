import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultShards,
  parseArguments,
  releaseKey,
  shardPlan,
  shardPublicationEnvironment,
  shardPublicationOutputRoot,
} from "../../scripts/e2e-parallel.mjs";

describe("the parallel e2e runner's plan", () => {
  it("gives each shard its own slice, port and state directory", () => {
    const plan = shardPlan(3, 8820);
    expect(plan.map((shard) => shard.shard)).toEqual(["1/3", "2/3", "3/3"]);
    expect(new Set(plan.map((shard) => shard.port)).size).toBe(3);
    expect(new Set(plan.map((shard) => shard.name)).size).toBe(3);
    expect(plan.every((shard) => shard.name.startsWith("pkic-e2e."))).toBe(true);
  });

  it("takes its own options and hands the rest to Playwright", () => {
    expect(parseArguments(["--shards=2", "--base-port=9000", "tests/e2e/a.spec.ts", "-g", "x"], 8)).toEqual({
      shards: 2,
      basePort: 9000,
      prepared: null,
      passthrough: ["tests/e2e/a.spec.ts", "-g", "x"],
    });
  });

  it("takes a directory to keep the prepared release in", () => {
    expect(parseArguments(["--prepared=cache/release"], 2).prepared).toMatch(/cache\/release$/);
  });

  it("keys the prepared release by product code, not by test files", () => {
    const state = { head: "a", diff: "", files: "" };
    const run = (...args: string[]) =>
      args[0] === "rev-parse" ? state.head : args[0] === "diff" ? state.diff : state.files;
    const base = releaseKey(run);
    expect(releaseKey(run)).toBe(base);
    state.diff = "changed product file";
    expect(releaseKey(run)).not.toBe(base);
    state.diff = "";
    state.head = "b";
    expect(releaseKey(run)).not.toBe(base);
  });

  it("builds each shard's site publication in its own output and a clone of the checkout's cache", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pkic-e2e-parallel-test."));
    try {
      const checkoutCache = path.join(root, "checkout-cache");
      mkdirSync(path.join(checkoutCache, "publication"), { recursive: true });
      writeFileSync(path.join(checkoutCache, "publication", "entry"), "cached");
      const outputs = path.join(root, "outputs");
      const [first, second] = ["shard-1", "shard-2"].map((name) =>
        shardPublicationEnvironment(path.join(root, name), path.join(outputs, name), checkoutCache),
      );
      expect(first.PKIC_PUBLICATION_OUTPUT_ROOT).not.toBe(second.PKIC_PUBLICATION_OUTPUT_ROOT);
      expect(first.PKIC_PUBLICATION_CACHE_ROOT).not.toBe(second.PKIC_PUBLICATION_CACHE_ROOT);
      for (const environment of [first, second]) {
        expect(environment.PKIC_PUBLICATION_OUTPUT_ROOT.startsWith(outputs)).toBe(true);
        expect(readFileSync(path.join(environment.PKIC_PUBLICATION_CACHE_ROOT, "publication", "entry"), "utf8")).toBe(
          "cached",
        );
      }
      expect(
        shardPublicationEnvironment(
          path.join(root, "shard-3"),
          path.join(outputs, "shard-3"),
          path.join(root, "absent"),
        ),
      ).toMatchObject({
        PKIC_PUBLICATION_CACHE_ROOT: path.join(root, "shard-3", "publication-cache"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds every run's publications inside the checkout, where Astro keeps each prerender step apart", () => {
    const checkout = mkdtempSync(path.join(tmpdir(), "pkic-e2e-parallel-checkout."));
    try {
      const [first, second] = [shardPublicationOutputRoot(checkout), shardPublicationOutputRoot(checkout)];
      expect(first).not.toBe(second);
      for (const output of [first, second])
        expect(path.dirname(output)).toBe(path.join(checkout, ".cache", "e2e-publication"));
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  it("defaults to one shard per core, fewer when memory is short, and refuses nonsense", () => {
    const gib = 1024 ** 3;
    expect(defaultShards(10, 64 * gib)).toBe(10);
    expect(defaultShards(10, 16 * gib)).toBe(8);
    expect(defaultShards(4, 1 * gib)).toBe(1);
    expect(parseArguments([], 3).shards).toBe(3);
    expect(() => parseArguments(["--shards=0"])).toThrow();
  });
});
