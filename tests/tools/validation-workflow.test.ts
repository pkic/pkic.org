import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSeq, parseDocument } from "yaml";

const workflow = parseDocument(readFileSync(".github/workflows/backend-tests.yml", "utf8"));
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

describe("required application validation check", () => {
  it("runs even after a prerequisite fails and includes every validation family", () => {
    expect(String(workflow.getIn(["jobs", "application", "if"]))).toBe("always()");
    expect(jobNames.sort()).toEqual(["browser", "preflight", "worker"]);
    expect(aggregate().status).toBe(0);
  });

  it.each(["preflight", "browser", "worker"])("rejects a failed %s job", (job) => {
    expect(aggregate({ [job]: "failure" }).status).toBe(1);
  });

  it.each(["cancelled", "skipped"])("rejects a %s required job", (result) => {
    expect(aggregate({ worker: result }).status).toBe(1);
  });
});
