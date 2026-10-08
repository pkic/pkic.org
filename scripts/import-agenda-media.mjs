import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerLegacyAgendaSchemaResolution } from "./lib/legacy-agenda-runtime.mjs";
registerLegacyAgendaSchemaResolution();
const { prepareAgendaMediaUpload, importAgendaMedia, agendaMediaStateSchema } =
  await import("./lib/agenda-media-import-client.mjs");
const args = process.argv.slice(2),
  values = new Map();
let apply = false;
try {
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--apply") {
      apply = true;
      continue;
    }
    if (
      !["--report", "--mappings", "--repository-root", "--base-url", "--event", "--receipts"].includes(name) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--") ||
      values.has(name)
    )
      throw new Error("Invalid or repeated media import option.");
    values.set(name, args[++index]);
  }
  for (const name of ["--report", "--mappings", "--repository-root", "--base-url", "--event", "--receipts"])
    if (!values.has(name))
      throw new Error(
        `Supply ${name}. Default mode reviews verified local PDFs; --apply uploads private draft versions.`,
      );
  const receiptsPath = resolve(values.get("--receipts")),
    report = JSON.parse(await readFile(values.get("--report"), "utf8")),
    mappings = JSON.parse(await readFile(values.get("--mappings"), "utf8"));
  const assets = await prepareAgendaMediaUpload(report, mappings, values.get("--repository-root"));
  let state;
  try {
    state = agendaMediaStateSchema.parse(JSON.parse(await readFile(receiptsPath, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("Invalid media receipt file.", { cause: error });
  }
  const result = await importAgendaMedia({
    baseUrl: values.get("--base-url"),
    eventSlug: values.get("--event"),
    token: process.env.PKIC_AGENDA_IMPORT_TOKEN,
    assets,
    state,
    apply,
    saveState: async (current) => {
      await mkdir(dirname(receiptsPath), { recursive: true });
      const temporary = `${receiptsPath}.${process.pid}.new`;
      await writeFile(temporary, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, receiptsPath);
    },
  });
  console.info(
    JSON.stringify({
      planned: result.planned,
      uploaded: result.uploaded,
      reconciled: result.reconciled,
      applied: result.applied,
      published: false,
      assets: assets.map(
        ({ sourcePath, authoredReference, sourceKey, sourceDigest, publicUrl, occurrenceId, bytes }) => ({
          sourcePath,
          authoredReference,
          sourceKey,
          sourceDigest,
          publicUrl,
          occurrenceId,
          bytes,
        }),
      ),
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error && error.name === "Error"
      ? error.message
      : "Invalid historical media input or response contract.",
  );
  process.exitCode = 1;
}
