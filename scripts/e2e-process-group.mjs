/**
 * Stops a detached process group and returns only once every member is gone.
 *
 * The local Worker is a CLI that starts `workerd` children. Waiting for the CLI alone returns while a child still
 * holds the listening port, and the next Worker then fails to bind it and takes the whole test server down. The
 * group gets the grace period to end on SIGTERM, then SIGKILL.
 */
function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function stopProcessGroup(pid, { graceMs = 10_000, pollMs = 50 } = {}) {
  if (!groupAlive(pid)) return;
  process.kill(-pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (groupAlive(pid) && Date.now() < deadline) await pause(pollMs);
  if (!groupAlive(pid)) return;
  process.kill(-pid, "SIGKILL");
  while (groupAlive(pid)) await pause(pollMs);
}
