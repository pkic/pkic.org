import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { marked } from "marked";
import { parse } from "yaml";
import { z } from "zod";
import type { ModelVersionSource } from "../assets/shared/model-versions";

/** Every link and image target Markdown resolves, including reference definitions and autolinks. */
function linkTargets(value: string): string[] {
  const tokens = marked.lexer(value);
  const targets = Object.values(tokens.links).map((link) => link.href);
  // Synchronous: the callback returns nothing, so there are no promises to await.
  void marked.walkTokens(tokens, (token) => {
    if (token.type === "link" || token.type === "image") targets.push(token.href);
  });
  return targets;
}

/** Relative targets and web or mail links only; character references could hide a scheme. */
function safeLinkTarget(target: string) {
  // Browsers ignore whitespace and control characters inside a scheme.
  const compact = [...target].filter((character) => character > " ").join("");
  if (/&(?:#[0-9a-z]+|[a-z][a-z0-9]*);/i.test(compact)) return false;
  const scheme = /^([^/?#]*?):/.exec(compact)?.[1]?.toLowerCase();
  return scheme === undefined || ["http", "https", "mailto"].includes(scheme);
}

/**
 * Model text is rendered by the site's own Markdown pipeline, so it may only contain Markdown:
 * raw HTML and links outside the allowed protocols fail the build instead of being rewritten.
 */
const modelText = z
  .string()
  .refine((value) => !/<[A-Za-z!/?]/.test(value), "Model text must be Markdown without raw HTML")
  .refine(
    (value) => linkTargets(value).every(safeLinkTarget),
    "Model links must be relative or use http, https or mailto, not script-capable protocols",
  );
const itemId = z.string().regex(/^[0-9]+(?:\.[a-z0-9]+)+$/, "Model item identifiers use dotted segments");
const textItem = z.object({ id: itemId, text: modelText });
const criterion = textItem.extend({ assessmentQuestionIds: z.array(itemId).optional() });
const question = z.object({
  id: itemId,
  question: modelText,
  guidance: modelText.default(""),
  expectedInput: modelText.optional(),
  purpose: modelText.optional(),
});
const section = z.object({
  title: modelText,
  body: modelText,
  placement: z.enum(["after-criteria", "after-assessment", "after-evidence-checklist"]).default("after-criteria"),
});
// This is the rendering projection; the canonical model contract remains in pkic/pqcmm.
export const readableModelSchema = z.object({
  model: z.object({ id: z.literal("pqcmm"), version: z.string(), description: modelText.default("") }),
  scoring: z.object({ rule: modelText }),
  levels: z
    .array(
      z.object({
        number: z.number().int().min(0).max(5),
        name: z.string(),
        title: z.string(),
        description: modelText,
        summary: modelText,
        sourcePage: z.string().regex(/^\/wg\/pqc\/pqcmm\/levels\/[a-z0-9-]+\/$/),
        criteria: z.object({ introduction: modelText, items: z.array(criterion) }),
        assessment: z.object({
          methodology: modelText,
          groups: z.array(
            z.object({
              id: itemId.optional(),
              name: modelText,
              kind: z.enum(["assessment", "intake"]).default("assessment"),
              introduction: modelText.optional(),
              questions: z.array(question),
            }),
          ),
        }),
        evidenceChecklist: z.object({ introduction: modelText, items: z.array(textItem) }),
        sections: z.array(section).default([]),
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

/** Only normative level details depend on model bytes; shared guidance stays available offline. */
export async function loadModelLevelSource(
  repository: string,
  sourcePath: string,
  version: ModelVersionSource,
  page: string,
) {
  return /^levels\/[^/]+\/$/.test(page) ? loadModelVersion(repository, sourcePath, version) : undefined;
}
