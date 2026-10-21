import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { ModelVersionSource } from "../assets/shared/model-versions";

const textItem = z.object({ id: z.string(), text: z.string() });
const question = z.object({ id: z.string(), question: z.string(), guidance: z.string().default("") });
// This is the rendering projection; the canonical model contract remains in pkic/pqcmm.
export const readableModelSchema = z.object({
  model: z.object({ id: z.literal("pqcmm"), version: z.string(), description: z.string().default("") }),
  scoring: z.object({ rule: z.string() }),
  levels: z
    .array(
      z.object({
        number: z.number().int().min(0).max(5),
        name: z.string(),
        title: z.string(),
        description: z.string(),
        summary: z.string(),
        sourcePage: z.string().regex(/^\/wg\/pqc\/pqcmm\/levels\/[a-z0-9-]+\/$/),
        criteria: z.object({ introduction: z.string(), items: z.array(textItem) }),
        assessment: z.object({
          methodology: z.string(),
          groups: z.array(z.object({ name: z.string(), questions: z.array(question) })),
        }),
        evidenceChecklist: z.object({ introduction: z.string(), items: z.array(textItem) }),
        sections: z
          .array(z.object({ title: z.string(), body: z.string(), placement: z.string().optional() }))
          .default([]),
      }),
    )
    .min(1),
});
export type ReadableModel = z.infer<typeof readableModelSchema>;

export function verifyModelVersion(bytes: string, version: ModelVersionSource) {
  if (createHash("sha256").update(bytes).digest("hex") !== version.sha256)
    throw new Error(`Model digest mismatch: ${version.id}`);
  const model = readableModelSchema.parse(parse(bytes));
  if (model.model.version !== version.version) throw new Error(`Model version mismatch: ${version.id}`);
  if (new Set(model.levels.map((l) => l.number)).size !== model.levels.length)
    throw new Error("Duplicate model levels");
  if (new Set(model.levels.map((l) => l.sourcePage)).size !== model.levels.length)
    throw new Error("Duplicate model level paths");
  return model;
}

/** Build-time only: visitors receive static pages, never GitHub browsing requests. */
async function readModelVersion(repository: string, sourcePath: string, version: ModelVersionSource) {
  const cache = resolve("node_modules/.cache/model-versions", `${version.sha256}.yaml`);
  let bytes: string | undefined;
  try {
    bytes = await readFile(cache, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (bytes === undefined) {
    const url = `https://raw.githubusercontent.com/${repository}/${version.commit}/${sourcePath}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Cannot fetch model version ${version.id}: ${response.status}`);
    bytes = await response.text();
    verifyModelVersion(bytes, version);
    await mkdir(resolve("node_modules/.cache/model-versions"), { recursive: true });
    await writeFile(cache, bytes);
  }
  return verifyModelVersion(bytes, version);
}

const modelReads = new Map<string, Promise<ReadableModel>>();
export function loadModelVersion(repository: string, sourcePath: string, version: ModelVersionSource) {
  const key = [repository, sourcePath, version.commit, version.sha256, version.version].join(":");
  let result = modelReads.get(key);
  if (!result) {
    result = readModelVersion(repository, sourcePath, version);
    modelReads.set(key, result);
  }
  return result;
}
