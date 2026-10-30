import { describe, expect, it } from "vitest";
import { defaultShards, parseArguments, shardPlan } from "../../scripts/e2e-parallel.mjs";

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

  it("defaults to one shard per core, fewer when memory is short, and refuses nonsense", () => {
    const gib = 1024 ** 3;
    expect(defaultShards(10, 64 * gib)).toBe(10);
    expect(defaultShards(10, 16 * gib)).toBe(8);
    expect(defaultShards(4, 1 * gib)).toBe(1);
    expect(parseArguments([], 3).shards).toBe(3);
    expect(() => parseArguments(["--shards=0"])).toThrow();
  });
});
