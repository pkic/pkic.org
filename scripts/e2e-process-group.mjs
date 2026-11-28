import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    // A container's PID 1 may never reap orphaned children. Zombies still answer
    // kill(0), but have exited and released their ports; no signal can remove them.
    const { stdout } = await run("ps", ["-eo", "pgid=,stat="]);
    return stdout.split("\n").some((line) => {
      const [group, state] = line.trim().split(/\s+/);
      return Number(group) === pid && state && !state.startsWith("Z");
    });
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    // The last member can exit between the liveness check and this signal.
    if (error?.code !== "ESRCH") throw error;
  }
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Stops a detached process group and returns only once every member has exited.
 *
 * The local Worker is a CLI that starts `workerd` children. Waiting for the CLI alone returns while a child still
 * holds the listening port, and the next Worker then fails to bind it and takes the whole test server down. The
 * group gets the grace period to end on SIGTERM, then SIGKILL.
 */
export async function stopProcessGroup(pid, { graceMs = 10_000, pollMs = 50 } = {}) {
  if (!(await groupAlive(pid))) return;
  signalGroup(pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while ((await groupAlive(pid)) && Date.now() < deadline) await pause(pollMs);
  if (!(await groupAlive(pid))) return;
  signalGroup(pid, "SIGKILL");
  while (await groupAlive(pid)) await pause(pollMs);
}
