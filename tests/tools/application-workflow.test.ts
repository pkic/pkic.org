import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name: string; run?: string; if?: string; env?: Record<string, string> };
type Job = {
  name: string;
  needs?: string;
  if?: string;
  "continue-on-error"?: boolean;
  strategy?: {
    "fail-fast": boolean;
    matrix: { include: { suite: string; shard?: string }[] };
  };
  steps: Step[];
};
const workflow = parse(readFileSync(new URL("../../.github/workflows/backend-tests.yml", import.meta.url), "utf8")) as {
  jobs: Record<string, Job>;
};

describe("application validation coverage", () => {
  it("partitions the full Worker suite and cancels siblings on failure", () => {
    const job = workflow.jobs.validation;
    expect(job.strategy?.["fail-fast"]).toBe(true);
    expect(job["continue-on-error"]).toBeUndefined();
    const entries = job.strategy!.matrix.include;
    expect(entries.filter((entry) => entry.suite === "site")).toHaveLength(1);
    const shards = entries.filter((entry) => entry.suite === "worker").map((entry) => entry.shard);
    expect(shards.length).toBeGreaterThan(1);
    expect([...shards].sort()).toEqual(shards.map((_, index) => `${index + 1}/${shards.length}`).sort());
    const worker = job.steps.find((step) => step.name === "Run Worker and D1 integration tests")!;
    expect(worker.if).toBe("matrix.suite == 'worker'");
    expect(worker.run).toBe("pnpm run test:worker --bail=1 --shard=${{ matrix.shard }}");
    for (const suite of ["unit", "frontend", "tools"]) {
      expect(job.steps.some((step) => step.run === `pnpm run test:${suite} --bail=1`)).toBe(true);
    }
    expect(job.steps.some((step) => step.run === "pnpm run test:e2e:ci")).toBe(true);
  });

  it("keeps the required gate red for failed, cancelled, or skipped validation", () => {
    const gate = workflow.jobs.application;
    expect(gate.name).toBe("Application checks (fail-fast sequence)");
    expect(gate.needs).toBe("validation");
    expect(gate.if).toBe("always()");
    expect(gate["continue-on-error"]).toBeUndefined();
    expect(gate.steps).toHaveLength(1);
    expect(gate.steps[0].env?.VALIDATION_RESULT).toBe("${{ needs.validation.result }}");
    expect(gate.steps[0].run).toBe('test "$VALIDATION_RESULT" = success');
  });
});
