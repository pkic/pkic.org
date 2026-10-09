#!/usr/bin/env node
/**
 * Move verified authored speaker headshots of canonically mapped people into R2 through the
 * existing staff headshot API, and point their reviewed historical credits at those portraits.
 *
 * Usage:
 *   PKIC_AGENDA_IMPORT_TOKEN=… node --experimental-strip-types scripts/import-agenda-headshots.mjs \
 *     --report <prepared agenda.json.report.json> --mappings <mappings.json> --repository-root <repo> \
 *     --base-url <origin> --receipts <headshots.receipts.json> --mappings-out <mappings.headshots.json> [--apply]
 *
 * Default: verify local files and read each person's current headshot; nothing is uploaded or written.
 * --apply: upload only for people without a headshot, save receipts, and write the updated mappings.
 * Rerunning with the same files uploads nothing and writes identical mappings.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerLegacyAgendaSchemaResolution } from "./lib/legacy-agenda-runtime.mjs";
registerLegacyAgendaSchemaResolution();
const { prepareAgendaHeadshotUpload, importAgendaHeadshots, agendaHeadshotStateSchema, mappingsWithHeadshots } =
  await import("./lib/agenda-headshot-import-client.mjs");

const OPTIONS = ["--report", "--mappings", "--repository-root", "--base-url", "--receipts", "--mappings-out"];
const usage = `Usage: node --experimental-strip-types scripts/import-agenda-headshots.mjs ${OPTIONS.map((name) => `${name} <value>`).join(" ")} [--apply]. Set PKIC_AGENDA_IMPORT_TOKEN in the environment.`;

async function writeAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.new`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}

try {
  const args = process.argv.slice(2);
  const values = new Map();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--apply") {
      apply = true;
      continue;
    }
    if (!OPTIONS.includes(name) || !args[index + 1] || args[index + 1].startsWith("--") || values.has(name))
      throw new Error(usage);
    values.set(name, args[++index]);
  }
  for (const name of OPTIONS) if (!values.has(name)) throw new Error(usage);
  const receiptsPath = resolve(values.get("--receipts"));
  const mappingsOutPath = resolve(values.get("--mappings-out"));
  if (mappingsOutPath === resolve(values.get("--mappings")))
    throw new Error("Write the updated mappings to a new file; the reviewed input stays unchanged.");
  const report = JSON.parse(await readFile(values.get("--report"), "utf8"));
  const mappings = JSON.parse(await readFile(values.get("--mappings"), "utf8"));
  const prepared = await prepareAgendaHeadshotUpload(report, mappings, values.get("--repository-root"));
  let state;
  try {
    state = agendaHeadshotStateSchema.parse(JSON.parse(await readFile(receiptsPath, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("Invalid headshot receipt file.", { cause: error });
  }
  const result = await importAgendaHeadshots({
    baseUrl: values.get("--base-url"),
    token: process.env.PKIC_AGENDA_IMPORT_TOKEN,
    assets: prepared.assets,
    sourcePath: prepared.sourcePath,
    state,
    apply,
    saveState: (current) => writeAtomically(receiptsPath, current),
  });
  const updated = mappingsWithHeadshots(mappings, result.results);
  if (apply) await writeAtomically(mappingsOutPath, updated.mappings);
  const count = (action) => result.results.filter((row) => row.action === action).length;
  console.info(
    JSON.stringify({
      applied: apply,
      people: result.results.length,
      uploaded: count("uploaded"),
      keptExisting: count("existing"),
      wouldUpload: count("would_upload"),
      mappingPhotoUrlsChanged: updated.changed,
      mappingsWritten: apply ? mappingsOutPath : null,
      findings: [...prepared.findings, ...updated.findings],
      results: result.results,
    }),
  );
} catch (error) {
  // Validation messages can contain supplied data; expose only deliberate operational errors.
  console.error(
    error instanceof Error && error.name === "Error" ? error.message : "Invalid headshot import input or response.",
  );
  process.exitCode = 1;
}
