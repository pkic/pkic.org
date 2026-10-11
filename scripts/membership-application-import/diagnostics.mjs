import { open } from "node:fs/promises";
import { constants } from "node:fs";

/** @typedef {{phase: string, error: unknown, status: string, sourceIssueNumber: number, timeoutMs: number}} ImportFailure */
/** @typedef {(failure: ImportFailure) => Promise<void>} ImportFailureListener */

const commandDetails = new WeakMap();

/** Raw subprocess output is kept out of Error messages and public console output. */
export class ImportCommandError extends Error {
  constructor(details) {
    super(`Operational command ${details.kind}`);
    this.name = "ImportCommandError";
    commandDetails.set(this, details);
  }
}

function redact(text, env) {
  let safe = text;
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 4 && /token|secret|password|credential|api[_-]?key|authorization/i.test(name))
      safe = safe.replaceAll(value, "[redacted]");
  }
  return safe
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|SG\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      "[redacted]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, "$1 [redacted]");
}

function describe(error) {
  const details = commandDetails.get(error);
  if (!details) return { summary: "Importer operation failed", message: error?.message ?? "Unknown error" };
  const summary = {
    exit: `Command exited with code ${details.exitCode}`,
    spawn: `Could not start command (${details.systemCode ?? "unknown OS error"})`,
    timeout: "Per-source timeout expired",
    interrupted: "Command interrupted",
    output_limit: "Command output exceeded the 4 MiB limit",
    signal: `Command terminated by ${details.signal}`,
  }[details.kind];
  // Only recognized database/network diagnostics enter console output; never echo arbitrary stderr or SQL.
  const outputCause = `${details.stderr}\n${details.stdout}`.match(
    /(?:no such (?:table|column): [A-Za-z_][A-Za-z0-9_.]*|(?:NOT NULL|UNIQUE) constraint failed: [A-Za-z_][A-Za-z0-9_.]*(?:, [A-Za-z_][A-Za-z0-9_.]*)*|FOREIGN KEY constraint failed|database is locked|statement too long|SQLITE_(?:ERROR|BUSY|LOCKED|CONSTRAINT|TOOBIG)|authentication error|HTTP (?:401|403|404|429|5[0-9]{2})|\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b)/i,
  )?.[0];
  return { ...details, summary: `${summary}${outputCause ? `; ${outputCause}` : ""}` };
}

/** Append failures beside the private report; never log successful GitHub exports or SQL arguments. */
export async function logImportFailure(
  path,
  { phase, error, status, sourceIssueNumber, timeoutMs },
  env = process.env,
) {
  const details = describe(error);
  const args = [...(details.args ?? [])];
  for (let index = 0; index < args.length; index++) {
    if (["--command", "--file"].includes(args[index])) args[++index] = "[private SQL omitted]";
  }
  const summary = redact(details.summary, env);
  const record = JSON.stringify(
    { at: new Date().toISOString(), sourceIssueNumber, phase, status, timeoutMs, ...details, args },
    (_key, value) => (typeof value === "string" ? redact(value, env) : value),
  );
  let file;
  try {
    file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    if (!(await file.stat()).isFile()) throw new Error("Diagnostic path must be a regular file");
    await file.chmod(0o600);
    await file.writeFile(`${record}\n`);
    console.error(
      `[application-import] Issue #${sourceIssueNumber}, ${phase}: ${summary}. Private diagnostics: ${path}`,
    );
  } catch {
    console.error(
      `[application-import] Issue #${sourceIssueNumber}, ${phase}: ${summary}. Could not write private diagnostics to ${path}`,
    );
  } finally {
    await file?.close().catch(() => {});
  }
  if (status === "uncertain")
    console.error(
      "[application-import] The write may have committed. Resume with the same manifest and report to reconcile it.",
    );
}
