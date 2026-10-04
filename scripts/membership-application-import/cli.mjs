import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadImportContracts, parseManifest } from "./manifest.mjs";
import { privatePaths, readJson, existingReport, lockReport, writeReport } from "./files.mjs";
import { createReport, resumeReport, executeBatch } from "./batch.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const help = `Usage: pnpm import:applications --manifest /secure/reviewed.json --report /secure/results.json [--execute [--resume]]

Default: offline dry-run; validates reviewed entries and writes a report without network requests.
--dry-run          Explicit offline validation (also the default).
--execute          Import reviewed entries through the existing portal API, sequentially.
--resume           Resume an execution report for the exact same manifest and destination.
--timeout-seconds  Per-request timeout (default 120, range 1–600). No automatic retries.
--help             Show this help.

Execution reads PKIC_PORTAL_SESSION_TOKEN from the environment (a staff user session with membership:approve).
Keep both files outside the repository. Production targets the configured production origin.
Local rehearsal requires sourceData=synthetic and an HTTP loopback origin. Preview is not an import target.
The server must have migration 0037 and production GitHub source access configured separately.
This command never activates workflows or changes GitHub issues.
Exit codes: 0 complete/valid dry-run, 1 invalid input or local failure, 2 unresolved/incomplete, 130 interrupted.
See scripts/membership-application-import/README.md for the manifest format and recovery steps.`;

export async function runCli(argv, environment = process.env) {
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
  if (config.error) throw new Error("Cannot read the configured production portal origin");
  const manifest = parseManifest(
    await readJson(paths.manifest),
    contracts,
    config.config.env.production.vars.APP_BASE_URL,
  );
  const token = options.execute ? environment.PKIC_PORTAL_SESSION_TOKEN?.trim() : null;
  if (options.execute && !token)
    throw new Error("Execution requires PKIC_PORTAL_SESSION_TOKEN for an authorized staff user");
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
        token,
        signal: controller.signal,
        timeoutMs: seconds * 1000,
        save: (state) => writeReport(paths.report, state),
        onResult: (entry) =>
          console.log(
            `Issue #${entry.sourceIssueNumber}: ${entry.status}${entry.httpStatus ? ` (HTTP ${entry.httpStatus})` : ""}`,
          ),
      });
    } else {
      await writeReport(paths.report, report);
      exitCode = report.summary.unresolved ? 2 : 0;
    }
    console.log(`${report.mode}: ${JSON.stringify(report.summary)}`);
    console.log(`Results report: ${paths.report}`);
    if (!options.execute)
      console.log(
        "Offline validation only; source eligibility, identities, forms, and workflow evidence are rechecked by the server during execution.",
      );
    return exitCode;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await unlock();
  }
}
