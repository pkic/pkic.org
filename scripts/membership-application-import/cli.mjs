import { parseArgs } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { repositoryRoot as root } from "./process.mjs";
import ts from "typescript";
import { backfillEnvironmentSchema, parseManifest } from "./manifest.mjs";
import { loadImportContracts } from "./load-contracts.mjs";
import { privatePaths, readJson, existingReport, lockReport, writeReport } from "./files.mjs";
import { createReport, resumeReport, executeBatch } from "./batch.mjs";

const help = `Usage: pnpm import:applications --manifest /secure/reviewed.json --report /secure/results.json [--execute [--resume]]

Default: offline dry-run. --dry-run makes this explicit.
--execute          Backfill supported closed applications directly into existing D1 tables.
--resume           Resume an execution report for exactly the same manifest and database.
--timeout-seconds  Per-source timeout (default 120, range 1–600). No automatic retry.
--help             Show help.

Use reviewed version-2 manifests. Unsupported history and active work remain unresolved.
Production revalidates sources through gh. Remote destinations use Wrangler credentials.
Local and preview use embedded synthetic evidence. No portal token is needed.
The manifest selects production, preview, or local. Local and preview require synthetic data.
Production requires separately authorized data backfill.
The command does not deploy code, change schema, activate workflows, or edit GitHub issues.
Keep manifests and reports outside the repository.
Exit codes: 0 complete, 1 invalid input/local failure, 2 unresolved/incomplete, 130 interrupted.
See scripts/membership-application-import/README.md for mapping and recovery.`;

export async function runCli(argv) {
  let options;
  try {
    options = parseArgs({
      args: argv,
      strict: true,
      options: {
        manifest: { type: "string" },
        report: { type: "string" },
        execute: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        resume: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        "timeout-seconds": { type: "string", default: "120" },
      },
    }).values;
  } catch {
    throw new Error("Invalid arguments; use --help. Credentials belong in the environment, never in arguments.");
  }
  if (options.help) {
    console.log(help);
    return 0;
  }
  if (options.execute && options["dry-run"]) throw new Error("Choose either --dry-run or --execute");
  if (!options.manifest || !options.report || (options.resume && !options.execute))
    throw new Error("Provide --manifest and --report; --resume also requires --execute");
  const seconds = Number(options["timeout-seconds"]);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new Error("Timeout must be 1–600 seconds");
  const paths = await privatePaths(resolve(options.manifest), resolve(options.report), root);
  const contracts = await loadImportContracts();
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    await readFile(resolve(root, "wrangler.jsonc"), "utf8"),
  );
  if (config.error) throw new Error("Cannot read the configured database destination");
  const input = await readJson(paths.manifest);
  const target = backfillEnvironmentSchema.safeParse(input?.environment);
  if (!target.success) throw new Error("Manifest environment must be production, preview, or local");
  const databaseId = config.config.env?.[target.data]?.d1_databases?.find(
    (binding) => binding.binding === "DB",
  )?.database_id;
  if (!databaseId) throw new Error("Selected environment has no configured DB binding");
  const manifest = parseManifest(input, contracts, databaseId);
  if (manifest.localDirectory) {
    const directory = await realpath(manifest.localDirectory);
    if (directory !== manifest.localDirectory) throw new Error("Use the canonical local database directory path");
  }
  const unlock = await lockReport(paths.report);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const previous = await existingReport(paths.report);
    if (previous !== undefined && !options.resume)
      throw new Error("Report exists; choose another path or explicitly --execute --resume");
    if (previous === undefined && options.resume) throw new Error("Cannot resume: the execution report does not exist");
    const report =
      previous !== undefined
        ? resumeReport(previous, manifest, contracts)
        : createReport(manifest, contracts, options.execute);
    let exitCode;
    if (options.execute) {
      exitCode = await executeBatch({
        manifest,
        report,
        contracts,
        directory: dirname(paths.report),
        signal: controller.signal,
        timeoutMs: seconds * 1000,
        save: (state) => writeReport(paths.report, state),
        onResult: (entry) =>
          console.log(`Issue #${entry.sourceIssueNumber}: ${entry.status}${entry.error ? ` (${entry.error})` : ""}`),
      });
    } else {
      await writeReport(paths.report, report);
      exitCode = report.summary.unresolved ? 2 : 0;
    }
    console.log(`${report.mode}: ${JSON.stringify(report.summary)}`);
    console.log(`Results report: ${paths.report}`);
    if (!options.execute)
      console.log(
        "Offline validation only; execution rechecks existing records, identities, and categories. Production also rechecks GitHub evidence.",
      );
    return exitCode;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await unlock();
  }
}
