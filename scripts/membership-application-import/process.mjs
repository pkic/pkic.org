import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ImportCommandError } from "./diagnostics.mjs";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Capture private command output; terminate the whole child group on interruption. */
export function runCommand(command, args, signal) {
  return new Promise((resolve, reject) => {
    const failure = (kind, extra = {}) =>
      new ImportCommandError({ command, args, kind, stdout: output, stderr, ...extra });
    const abortKind = () => (signal.reason?.name === "TimeoutError" ? "timeout" : "interrupted");
    let output = "";
    let stderr = "";
    if (signal.aborted) {
      reject(failure(abortKind()));
      return;
    }
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], cwd: repositoryRoot, detached: grouped });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
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
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk) => receive(chunk, true));
    child.stderr.on("data", (chunk) => receive(chunk, false));
    signal.addEventListener("abort", terminate, { once: true });
    child.on("error", (error) => {
      signal.removeEventListener("abort", terminate);
      reject(failure("spawn", { systemCode: error.code }));
    });
    child.on("close", (code, terminationSignal) => {
      signal.removeEventListener("abort", terminate);
      if (code !== 0 || signal.aborted || exceeded)
        reject(
          failure(exceeded ? "output_limit" : signal.aborted ? abortKind() : terminationSignal ? "signal" : "exit", {
            exitCode: code,
            signal: terminationSignal,
          }),
        );
      else resolve(output);
    });
  });
}
