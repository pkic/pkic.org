import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { stopProcessGroup } from "../../scripts/e2e-process-group.mjs";

function alive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A leader that exits at once, leaving a child that keeps running, as a CLI does with its runtime. */
function leaderWithLingeringChild(childScript: string): Promise<number> {
  const leader = spawn("sh", ["-c", `(${childScript}) & echo $!; exit 0`], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return new Promise((resolve) => {
    leader.stdout.once("data", () => resolve(leader.pid!));
  });
}

describe("stopping a test server's process group", () => {
  it("returns only after a child outliving its leader has ended", async () => {
    const group = await leaderWithLingeringChild("sleep 30");
    expect(alive(group)).toBe(true);
    await stopProcessGroup(group, { graceMs: 2000, pollMs: 10 });
    expect(alive(group)).toBe(false);
  });

  it("escalates to SIGKILL when a member ignores SIGTERM past the grace period", async () => {
    const group = await leaderWithLingeringChild("trap '' TERM; while :; do sleep 1; done");
    expect(alive(group)).toBe(true);
    await stopProcessGroup(group, { graceMs: 200, pollMs: 10 });
    expect(alive(group)).toBe(false);
  });

  it("does nothing for a group that is already gone", async () => {
    const group = await leaderWithLingeringChild("sleep 30");
    await stopProcessGroup(group, { graceMs: 2000, pollMs: 10 });
    await expect(stopProcessGroup(group, { graceMs: 100, pollMs: 10 })).resolves.toBeUndefined();
  });
});
