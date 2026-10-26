import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isMap, isSeq, parseDocument, parseAllDocuments } from "yaml";

const workflow = parseDocument(
  readFileSync(new URL("../../.github/workflows/backend-tests.yml", import.meta.url), "utf8"),
);
const dependencies = workflow.getIn(["jobs", "application", "needs"]);
if (!isSeq(dependencies)) throw new Error("The aggregate check must depend on validation jobs");
const jobNames = dependencies.items.map(String);
const check = String(workflow.getIn(["jobs", "application", "steps", 0, "run"]));

function aggregate(overrides: Record<string, string> = {}) {
  const needs = Object.fromEntries(jobNames.map((name) => [name, { result: overrides[name] ?? "success" }]));
  return spawnSync("bash", ["-c", check], {
    env: { ...process.env, RESULTS: JSON.stringify(needs) },
    encoding: "utf8",
  });
}

describe("application validation coverage", () => {
  it("partitions every Worker project completely and cancels siblings on failure", () => {
    expect(workflow.getIn(["jobs", "worker", "strategy", "fail-fast"])).toBe(true);
    expect(workflow.getIn(["jobs", "worker", "continue-on-error"])).toBeUndefined();
    const matrix = workflow.getIn(["jobs", "worker", "strategy", "matrix", "include"]);
    if (!isSeq(matrix)) throw new Error("Expected Worker partitions");
    const groups = new Map<string, string[]>();
    for (const entry of matrix.items) {
      if (!isMap(entry)) throw new Error("Expected a project/shard pair");
      const project = String(entry.get("project"));
      groups.set(project, [...(groups.get(project) ?? []), String(entry.get("shard"))]);
    }
    expect([...groups.keys()].sort()).toEqual(["d1", "worker-fetch"]);
    expect(groups.get("d1")!.length).toBeGreaterThan(1);
    for (const shards of groups.values()) {
      expect([...shards].sort()).toEqual(shards.map((_, index) => `${index + 1}/${shards.length}`).sort());
    }
    const steps = workflow.getIn(["jobs", "worker", "steps"]);
    if (!isSeq(steps)) throw new Error("Expected Worker test steps");
    const command = steps.items
      .filter(isMap)
      .map((step) => String(step.get("run")))
      .join("\n");
    expect(command).toContain("--project ${{ matrix.project }}");
    expect(command).toContain("--shard=${{ matrix.shard }}");
    expect(command).toContain("--bail=1");
  });

  it("retains Node, component, tooling, and critical browser coverage", () => {
    const jobs = workflow.get("jobs");
    if (!isMap(jobs)) throw new Error("Expected validation jobs");
    const commands: string[] = [];
    for (const entry of jobs.items) {
      if (!isMap(entry.value)) continue;
      const steps = entry.value.get("steps");
      if (isSeq(steps)) commands.push(...steps.items.filter(isMap).map((step) => String(step.get("run"))));
    }
    for (const suite of ["unit", "frontend", "tools"]) expect(commands).toContain(`pnpm run test:${suite} --bail=1`);
    expect(commands).toContain("pnpm run test:e2e:ci");
  });

  it("uses a preinstalled browser image matching the locked Playwright version", () => {
    const documents = parseAllDocuments(readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8"));
    const version = documents
      .map((document) => document.getIn(["importers", ".", "devDependencies", "@playwright/test", "version"]))
      .find((value) => typeof value === "string");
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(workflow.getIn(["jobs", "browser", "container", "image"])).toBe(
      `mcr.microsoft.com/playwright:v${version}-noble`,
    );
    expect(workflow.getIn(["jobs", "browser", "container", "options"])).toContain("--ipc=host");
  });

  it("runs even after a prerequisite fails and includes every validation family", () => {
    expect(String(workflow.getIn(["jobs", "application", "if"]))).toBe("always()");
    expect(workflow.getIn(["jobs", "application", "name"])).toBe("Application checks (fail-fast sequence)");
    expect(workflow.getIn(["jobs", "application", "continue-on-error"])).toBeUndefined();
    expect(jobNames.sort()).toEqual(["browser", "frontend-tools", "preflight", "worker"]);
    expect(aggregate().status).toBe(0);
  });

  it.each(["preflight", "frontend-tools", "browser", "worker"])("rejects a failed %s job", (job) => {
    expect(aggregate({ [job]: "failure" }).status).toBe(1);
  });

  it.each(["cancelled", "skipped"])("rejects a %s required job", (result) => {
    expect(aggregate({ worker: result }).status).toBe(1);
  });
});
