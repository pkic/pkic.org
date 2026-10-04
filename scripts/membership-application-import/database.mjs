import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { applicationBackfillSql, confirmationQuery, sourceId } from "./sql.mjs";
import { readGithubSource } from "./github.mjs";
import { runCommand } from "./process.mjs";
import { digest } from "./manifest.mjs";

export function databaseArguments(manifest) {
  return [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    manifest.environment,
    ...(manifest.environment === "production" ? ["--remote"] : ["--local", "--persist-to", manifest.localDirectory]),
    "--json",
  ];
}

export async function importEntry({
  manifest,
  entry,
  directory,
  signal,
  timeoutMs = 120_000,
  command = runCommand,
  readSource = readGithubSource,
}) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let writing = false;
  let temporary;
  try {
    if (manifest.environment === "production") {
      const fresh = await readSource(entry.sourceIssueNumber, deadline);
      if (digest(fresh) !== digest(entry.source)) return { status: "failed", error: "source_changed", stop: false };
    }
    const args = databaseArguments(manifest);
    const confirm = async () => {
      const results = JSON.parse(
        await command("pnpm", [...args, "--command", confirmationQuery(entry.source)], deadline),
      );
      if (!Array.isArray(results) || !results[0]?.success || !Array.isArray(results[0].results))
        throw new Error("Invalid database result");
      return results[0].results;
    };
    const existing = await confirm();
    if (existing.length)
      return existing[0].id === sourceId(entry.source) && existing[0].source_note === 1
        ? { status: "already_present", resultId: sourceId(entry.source), stop: false }
        : { status: "failed", error: "identity_conflict", stop: true };
    temporary = await mkdtemp(join(directory, ".application-sql-"));
    const path = join(temporary, "application.sql");
    await writeFile(path, applicationBackfillSql(manifest, entry), { mode: 0o600 });
    writing = true;
    await command("pnpm", [...args, "--file", path, "--yes"], deadline);
    const confirmed = await confirm();
    if (confirmed.length !== 1 || confirmed[0].id !== sourceId(entry.source) || confirmed[0].source_note !== 1)
      throw new Error("Import was not confirmed");
    return { status: "imported", resultId: sourceId(entry.source), stop: false };
  } catch {
    return {
      status: writing ? "uncertain" : "failed",
      error: signal.aborted ? "interrupted" : "operational_command",
      stop: true,
    };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
