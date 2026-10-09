import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { publicationRepairAliasesSchema } from "../../assets/shared/schemas/site-publication-repair-aliases.ts";

/** Reviewed native build input must never be copied from a publicly served tree. */
export async function readDocumentRepairAliases(path, protectedTrees) {
  if (!path) return [];
  const lexical = resolve(path);
  const source = await realpath(lexical);
  for (const tree of protectedTrees) {
    for (const base of [resolve(tree), await realpath(tree)]) {
      for (const input of [lexical, source]) {
        const child = relative(base, input);
        if (child === "" || (!child.startsWith("../") && !isAbsolute(child)))
          throw new Error("Repair alias input must stay outside public source, output, and staging trees");
      }
    }
  }
  return publicationRepairAliasesSchema.parse(JSON.parse(await readFile(source, "utf8")));
}
