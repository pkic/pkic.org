import { readFile } from "node:fs/promises";
import { registerLegacyAgendaSchemaResolution } from "./lib/legacy-agenda-runtime.mjs";
registerLegacyAgendaSchemaResolution();
const { importPreparedAgenda } = await import("./lib/agenda-import-client.mjs");
const args = process.argv.slice(2);
const usage =
  "Usage: node --experimental-strip-types scripts/import-agenda.mjs --base-url <origin> --event <slug> --document <prepared.json> [--document <next-part.json>] [--mode archive|copy_as_new] [--resolutions <file.json>] [--apply] [--acknowledge-inferred-timing] [--acknowledge-archive-representation]. Set PKIC_AGENDA_IMPORT_TOKEN in the environment. Default: review only.";
try {
  /** @type {Map<string,string>} */
  const values = new Map();
  const documents = [],
    flags = new Set();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (["--apply", "--acknowledge-inferred-timing", "--acknowledge-archive-representation"].includes(name)) {
      flags.add(name);
      continue;
    }
    if (
      !["--base-url", "--event", "--document", "--mode", "--resolutions"].includes(name) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw new Error(usage);
    const value = args[++index];
    if (name === "--document") documents.push(value);
    else {
      if (values.has(name)) throw new Error(usage);
      values.set(name, value);
    }
  }
  const baseUrl = values.get("--base-url"),
    eventSlug = values.get("--event"),
    mode = values.get("--mode") ?? "archive";
  if (!baseUrl || !eventSlug || !documents.length || !["archive", "copy_as_new"].includes(mode)) throw new Error(usage);
  const prepared = [];
  for (const path of documents) {
    prepared.push(JSON.parse(await readFile(path, "utf8")));
    let report;
    try {
      report = JSON.parse(await readFile(`${path}.report.json`, "utf8"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        throw new Error("Invalid preparation report.", { cause: error });
    }
    if (report && (report.ready !== true || !Array.isArray(report.unresolved) || report.unresolved.length))
      throw new Error("Preparation report has unresolved findings.");
  }
  const resolutionPath = values.get("--resolutions");
  await importPreparedAgenda({
    baseUrl,
    eventSlug,
    token: process.env.PKIC_AGENDA_IMPORT_TOKEN ?? "",
    documents: prepared,
    resolutions: resolutionPath ? JSON.parse(await readFile(resolutionPath, "utf8")) : undefined,
    mode: mode === "archive" ? "archive" : "copy_as_new",
    apply: flags.has("--apply"),
    acknowledgeInferredTiming: flags.has("--acknowledge-inferred-timing"),
    acknowledgeArchiveRepresentation: flags.has("--acknowledge-archive-representation"),
    onSummary: (summary) => console.info(JSON.stringify(summary)),
  });
} catch (error) {
  // Validation messages can contain supplied data; expose only deliberate operational errors.
  console.error(
    error instanceof Error && error.name === "Error" ? error.message : "Invalid agenda import contract or input file.",
  );
  process.exitCode = 1;
}
