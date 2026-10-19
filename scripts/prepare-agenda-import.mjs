import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { registerLegacyAgendaSchemaResolution } from "./lib/legacy-agenda-runtime.mjs";

registerLegacyAgendaSchemaResolution();
const { prepareLegacyAgendaImport } = await import("./lib/legacy-agenda-import.mjs");
const { readLegacyAgendaSource, legacyAgendaSourcePath, legacyAgendaEventReport, legacyAgendaDocuments } =
  await import("./lib/legacy-agenda-preparation.mjs");
const { resolveLegacyAgendaMedia } = await import("./lib/legacy-agenda-media.mjs");
const { resolveLegacyAgendaHeadshots } = await import("./lib/legacy-agenda-headshots.mjs");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args[0] === "--batch") {
  if (args.length !== 3)
    throw new Error(
      "Usage: node --experimental-strip-types scripts/prepare-agenda-import.mjs --batch <manifest.json> <output-directory>",
    );
  const manifestPath = resolve(args[1]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.events) || !manifest.events.length)
    throw new Error("The batch manifest must list events with sourcePath and mappingPath.");
  const outputDirectory = resolve(args[2]);
  await mkdir(outputDirectory, { recursive: true });
  const reports = [],
    names = new Set();
  for (const entry of manifest.events) {
    const sourcePath = resolve(dirname(manifestPath), entry.sourcePath);
    const name = entry.outputName ?? basename(dirname(sourcePath));
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(name) || names.has(name))
      throw new Error("Choose unique simple outputName values for every event.");
    names.add(name);
    reports.push(
      await prepare(
        sourcePath,
        resolve(dirname(manifestPath), entry.mappingPath),
        join(outputDirectory, `${name}.json`),
      ),
    );
  }
  await writeFile(
    join(outputDirectory, "manifest.json"),
    JSON.stringify({ applied: false, ready: reports.every((report) => report.ready), events: reports }, null, 2) + "\n",
  );
  console.info(
    JSON.stringify({ events: reports.length, ready: reports.every((report) => report.ready), applied: false }),
  );
} else {
  if (args.length !== 3)
    throw new Error(
      "Usage: node --experimental-strip-types scripts/prepare-agenda-import.mjs <authored Markdown or YAML> <explicit mappings.json> <output.json>",
    );
  const report = await prepare(resolve(args[0]), resolve(args[1]), resolve(args[2]));
  console.info(
    JSON.stringify({
      sourcePath: report.sourcePath,
      occurrences: report.counts.occurrences,
      unresolved: report.unresolved.length,
      ready: report.ready,
      applied: false,
    }),
  );
}
async function prepare(sourcePath, mappingPath, outputPath) {
  const text = await readFile(sourcePath, "utf8");
  const { source, metadata } = readLegacyAgendaSource(text, sourcePath);
  const mappings = JSON.parse(await readFile(mappingPath, "utf8"));
  const media = await resolveLegacyAgendaMedia(source, {
    ...mappings,
    sourcePath,
    contentRoot: join(repositoryRoot, "content"),
  });
  const headshots = await resolveLegacyAgendaHeadshots(source, {
    ...mappings,
    sourcePath,
    contentRoot: join(repositoryRoot, "content"),
  });
  const result = prepareLegacyAgendaImport(source, {
    ...mappings,
    ...media,
    photoUrls: headshots.photoUrls,
    sourcePath,
    repositoryRoot,
  });
  const event = legacyAgendaEventReport(metadata, source, legacyAgendaSourcePath(sourcePath, repositoryRoot), mappings);
  const unresolved = [...result.unresolved, ...media.unresolved];
  if (event.state === "mapping_required") unresolved.push({ kind: "event", message: event.action });
  const documents = legacyAgendaDocuments(result.document);
  const outputs = [];
  for (const [index, document] of documents.entries()) {
    const path = index === 0 ? outputPath : `${outputPath}.part-${index + 1}.json`;
    await writeFile(path, JSON.stringify(document, null, 2) + "\n");
    outputs.push({ path, occurrences: document.occurrences.length, state: "prepared_not_applied" });
  }
  if (!documents.length) await writeFile(outputPath, JSON.stringify(result.document, null, 2) + "\n");
  const report = {
    sourcePath: event.sourcePath,
    event,
    ready: unresolved.length === 0,
    applied: false,
    counts: {
      dates: Object.keys(source.agenda ?? {}).length,
      occurrences: result.document.occurrences.length,
      people: result.document.people.length,
      rooms: result.document.rooms.length,
      mediaReferences: result.document.occurrences.reduce((count, row) => count + row.media.length, 0),
    },
    outputs,
    unresolved,
    historicalCandidates: result.historicalCandidates,
    sourceRows: result.sourceRows,
    sourceDecisions: result.sourceDecisions,
    formatDecisions: result.formatDecisions,
    placeholderDecisions: result.placeholderDecisions,
    endMarkers: result.endMarkers,
    shadowedFragments: result.shadowedFragments,
    assets: media.assets,
    headshots,
    nextAction:
      "Verify target event and rooms, then review each document through the existing archive transfer API. Refresh expectedRevision after each applied part; no database completion is asserted here.",
  };
  await writeFile(`${outputPath}.report.json`, JSON.stringify(report, null, 2) + "\n");
  return report;
}
