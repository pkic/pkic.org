import { resolve } from "node:path";
import * as pagefind from "pagefind";
import { z } from "zod";
import { installReleaseBytes } from "./synchronize-release-files.mjs";

const searchEntrySchema = z.object({
  languages: z.record(z.string(), z.object({ page_count: z.number().int().nonnegative() })),
});

function requireSuccess(result, operation) {
  if (result.errors?.length) {
    throw new Error(`Pagefind ${operation} failed: ${result.errors.join("; ")}`);
  }
  return result;
}

/** Build search from the exact HTML release, including published database content. */
export async function indexPublicPages(output) {
  const { index } = requireSuccess(await pagefind.createIndex(), "initialization");
  if (!index) throw new Error("Pagefind did not create an index");
  try {
    requireSuccess(await index.addDirectory({ path: resolve(output) }), "indexing");
    const { files } = requireSuccess(await index.getFiles(), "generation");
    const entryFile = files.find((file) => file.path === "pagefind-entry.json");
    if (!entryFile) throw new Error("Pagefind did not generate its entry manifest");
    // addDirectory counts scanned files, including pages excluded from search.
    const entry = searchEntrySchema.parse(JSON.parse(Buffer.from(entryFile.content).toString("utf8")));
    // Await every file ourselves: the native writer can acknowledge before its
    // output is readable under load. Publication must own the completed writes.
    await Promise.all(files.map((file) => installReleaseBytes(file.content, resolve(output, "pagefind", file.path))));
    return { indexedPages: Object.values(entry.languages).reduce((total, language) => total + language.page_count, 0) };
  } finally {
    await index.deleteIndex();
  }
}
