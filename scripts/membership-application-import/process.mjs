import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Capture private command output; terminate the whole child group on interruption. */
export function runCommand(command, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Operation interrupted"));
      return;
    }
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], cwd: repositoryRoot, detached: grouped });
    child.stdout.setEncoding("utf8");
    let output = "";
    let size = 0;
    let exceeded = false;
    const terminate = () => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        /* The child may have exited before the signal arrived. */
      }
    };
    const receive = (chunk, stdout) => {
      size += Buffer.byteLength(chunk);
      if (size > 4 * 1024 * 1024) {
        exceeded = true;
        terminate();
      } else if (stdout) output += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk) => receive(chunk, true));
    child.stderr.on("data", (chunk) => receive(chunk, false));
    signal.addEventListener("abort", terminate, { once: true });
    child.on("error", () => {
      signal.removeEventListener("abort", terminate);
      reject(new Error("Operational command could not start"));
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", terminate);
      if (code !== 0 || signal.aborted || exceeded)
        reject(new Error("Operational command failed; inspect credentials, target, and reviewed evidence"));
      else resolve(output);
    });
  });
}
