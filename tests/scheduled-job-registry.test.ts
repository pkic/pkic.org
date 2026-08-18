/**
 * scheduled-job-registry.test.ts
 *
 * runScheduledJobRegistry (functions/_lib/services/scheduled-job-registry.ts)
 * — the shared budget/failure-isolation dispatcher functions/router.ts's
 * REMINDER_CRON entrypoint runs runScheduledDueWork/runMembershipDueWork/
 * runSponsorshipDueWork/runVotesDueWork through (PR #1 review §9.1). Pure
 * unit tests of the dispatcher itself — no D1/HTTP involved, since the
 * dispatcher never touches either directly.
 */
import { describe, expect, it } from "vitest";
import {
  runScheduledJobRegistry,
  type ScheduledJobDefinition,
} from "../functions/_lib/services/scheduled-job-registry";
import type { Env } from "../functions/_lib/types";

const fakeEnv = {} as Env;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Scheduled job registry", () => {
  it("PR #1 review §9.1: a mid-registry job failure is isolated — later jobs still run", async () => {
    const started: string[] = [];
    const jobs: ScheduledJobDefinition<unknown>[] = [
      { name: "first", minRemainingMsToRun: 0, run: async () => (started.push("first"), "first-result") },
      {
        name: "second",
        minRemainingMsToRun: 0,
        run: async () => {
          started.push("second");
          throw new Error("second job blew up");
        },
      },
      { name: "third", minRemainingMsToRun: 0, run: async () => (started.push("third"), "third-result") },
    ];

    const result = await runScheduledJobRegistry(fakeEnv, jobs, 60_000);

    // The old sequential-call design would have let "second"'s throw abort
    // the whole invocation, so "third" would never run.
    expect(started).toEqual(["first", "second", "third"]);
    expect(result.outcomes.map((o) => o.status)).toEqual(["completed", "error", "completed"]);
    expect(result.outcomes[1]).toMatchObject({ name: "second", status: "error", error: "second job blew up" });
    expect(result.outcomes[0]).toMatchObject({ name: "first", status: "completed", result: "first-result" });
    expect(result.outcomes[2]).toMatchObject({ name: "third", status: "completed", result: "third-result" });
  });

  it("PR #1 review §9.1: skips a later job outright once the shared budget can't cover its declared minimum, without running it", async () => {
    let secondJobRan = false;
    const jobs: ScheduledJobDefinition<unknown>[] = [
      {
        name: "slow_first",
        minRemainingMsToRun: 0,
        run: async () => {
          await sleep(80);
          return "slow-done";
        },
      },
      {
        name: "needs_more_than_remains",
        // The whole registry budget is 100ms and the first job alone
        // consumes ~80ms of it, so <100ms should remain — declaring a
        // requirement of 10 full seconds guarantees this job is skipped
        // regardless of scheduling jitter in the CI environment.
        minRemainingMsToRun: 10_000,
        run: async () => {
          secondJobRan = true;
          return "should-not-run";
        },
      },
    ];

    const result = await runScheduledJobRegistry(fakeEnv, jobs, 100);

    expect(secondJobRan).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ name: "slow_first", status: "completed" });
    expect(result.outcomes[1].status).toBe("skipped_budget");
    if (result.outcomes[1].status === "skipped_budget") {
      expect(result.outcomes[1].remainingMs).toBeLessThan(10_000);
    }
  });

  it("never starts two jobs concurrently — each completes before the next starts", async () => {
    const events: string[] = [];
    const jobs: ScheduledJobDefinition<unknown>[] = [
      {
        name: "a",
        minRemainingMsToRun: 0,
        run: async () => {
          events.push("a-start");
          await sleep(30);
          events.push("a-end");
        },
      },
      {
        name: "b",
        minRemainingMsToRun: 0,
        run: async () => {
          events.push("b-start");
          await sleep(10);
          events.push("b-end");
        },
      },
    ];

    await runScheduledJobRegistry(fakeEnv, jobs, 60_000);

    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("returns an empty outcome list for an empty job set", async () => {
    const result = await runScheduledJobRegistry(fakeEnv, [], 60_000);
    expect(result.outcomes).toEqual([]);
  });
});
