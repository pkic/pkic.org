import { parseArgs } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const { values } = parseArgs({
  options: {
    database: { type: "string" },
    credentials: { type: "string" },
    impersonate: { type: "string" },
    limit: { type: "string", default: "25" },
    mode: { type: "string", default: "incremental" },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    "Usage: pnpm exec node scripts/google-groups-sync-dry-run.mjs --database <SQLite file> --credentials <service-account.json> --impersonate <groups-reader@example.org> [--limit 25] [--mode incremental|full]",
  );
} else {
  if (!values.database || !values.credentials || !values.impersonate)
    throw new Error("--database, --credentials and --impersonate are required; use --help");
  if (!["incremental", "full"].includes(values.mode)) throw new Error("--mode must be incremental or full");
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 to 100");
  const credentials = JSON.parse(await readFile(values.credentials, "utf8"));
  if (
    credentials.type !== "service_account" ||
    typeof credentials.client_email !== "string" ||
    !credentials.client_email ||
    typeof credentials.private_key !== "string" ||
    !credentials.private_key
  )
    throw new Error("Expected a Google service-account JSON key");
  const temporary = await mkdtemp(join(tmpdir(), "pkic-groups-dry-run-"));
  try {
    // Bundle the canonical TypeScript graph without changing its runtime or maintaining a script copy.
    await build({
      configFile: false,
      ssr: { noExternal: true },
      logLevel: "error",
      build: {
        ssr: resolve("scripts/google-groups-sync/dry-run.ts"),
        outDir: temporary,
        rollupOptions: { output: { entryFileNames: "dry-run.mjs" } },
      },
    });
    const { runGoogleGroupsDryRun, runMailingListFullDryRun } = await import(
      pathToFileURL(join(temporary, "dry-run.mjs")).href
    );
    const env = {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: credentials.client_email,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: credentials.private_key,
      GOOGLE_WORKSPACE_ADMIN_EMAIL: values.impersonate,
    };
    const report =
      values.mode === "full"
        ? await runMailingListFullDryRun(values.database, env)
        : await runGoogleGroupsDryRun(values.database, env, limit);
    console.log(JSON.stringify(report, null, 2));
    if (report.failed || report.skippedUnconfigured) process.exitCode = 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
