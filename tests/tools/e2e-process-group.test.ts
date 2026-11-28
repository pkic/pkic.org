import { once } from "node:events";
import { readFile } from "node:fs/promises";
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

  it.skipIf(process.platform !== "linux")("returns when an unreaped child is only a zombie", async () => {
    // Stop the parent before it can reap its detached child, as a container's PID 1 may do.
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true, stdio: "ignore",
      });
      child.once("spawn", () => {
        console.log(child.pid);
        process.kill(process.pid, "SIGSTOP");
      });
      setInterval(() => {}, 1000);
    `,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let group: number | undefined;
    try {
      const [output] = await once(parent.stdout, "data");
      group = Number(String(output).trim());
      await expect.poll(async () => readFile(`/proc/${parent.pid}/stat`, "utf8")).toMatch(/\) T /);
      process.kill(-group, "SIGKILL");
      await expect.poll(async () => readFile(`/proc/${group}/stat`, "utf8")).toMatch(/\) Z /);
      expect(alive(group)).toBe(true);
      await stopProcessGroup(group, { graceMs: 100, pollMs: 10 });
      // The zombie still exists; waiting for kill(0) to fail would hang forever.
      expect(alive(group)).toBe(true);
    } finally {
      if (group) {
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          /* Already reaped. */
        }
      }
      parent.kill("SIGCONT");
      const closed = once(parent, "close");
      parent.kill("SIGTERM");
      await closed;
    }
  });

  it("does nothing for a group that is already gone", async () => {
    const group = await leaderWithLingeringChild("sleep 30");
    await stopProcessGroup(group, { graceMs: 2000, pollMs: 10 });
    await expect(stopProcessGroup(group, { graceMs: 100, pollMs: 10 })).resolves.toBeUndefined();
  });
});
