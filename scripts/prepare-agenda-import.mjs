import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { parseFrontMatter } from "../functions/_lib/services/site-markdown.ts";
import { prepareLegacyAgendaImport } from "./lib/legacy-agenda-import.mjs";

const [sourcePath, mappingPath, outputPath] = process.argv.slice(2);
if (!sourcePath || !mappingPath || !outputPath)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/prepare-agenda-import.mjs <authored _index.md> <explicit mappings.json> <output.json>",
  );
const document = await readFile(resolve(sourcePath), "utf8");
const source = sourcePath.endsWith(".md") ? parseFrontMatter(document).data.data : YAML.parse(document);
const mappings = JSON.parse(await readFile(resolve(mappingPath), "utf8"));
const result = prepareLegacyAgendaImport(source, { ...mappings, sourcePath });
await writeFile(resolve(outputPath), JSON.stringify(result, null, 2) + "\n");
console.info(
  JSON.stringify({
    sourcePath,
    occurrences: result.payload.occurrences.length,
    unresolved: result.unresolved.length,
    ready: result.ready,
    outputPath,
  }),
);
