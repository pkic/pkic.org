import { describe, expect, it, vi } from "vitest";
import { runScheduledJobWithD1Budget } from "../functions/_lib/services/scheduled-job-runner";
import type { DatabaseLike, Env, StatementLike } from "../functions/_lib/types";

function fakeEnv(): Env {
  const statement = {} as StatementLike;
  statement.bind = vi.fn(() => statement);
  statement.run = vi.fn().mockResolvedValue({ success: true });
  statement.all = vi.fn().mockResolvedValue({ results: [] });
  statement.first = vi.fn().mockResolvedValue(null);
  return { DB: { prepare: vi.fn(() => statement), batch: vi.fn().mockResolvedValue([]) } as DatabaseLike } as Env;
}

describe("scheduled job D1 runner", () => {
  it("reports actual statement usage for a completed job", async () => {
    const outcome = await runScheduledJobWithD1Budget(fakeEnv(), "test", 10, async (env) => {
      await env.DB.prepare("SELECT 1").all();
      return "done";
    });
    expect(outcome).toEqual({ status: "completed", result: "done", d1QueriesUsed: 1 });
  });

  it("turns an exhausted budget into a retryable cron outcome", async () => {
    const outcome = await runScheduledJobWithD1Budget(fakeEnv(), "test", 1, async (env) => {
      await env.DB.prepare("SELECT 1").all();
      await env.DB.prepare("SELECT 2").all();
    });
    expect(outcome).toEqual({ status: "d1_query_budget_exhausted", d1QueriesUsed: 1 });
  });
});
