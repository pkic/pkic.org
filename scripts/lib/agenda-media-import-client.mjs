import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { digestPdf } from "./legacy-agenda-media.mjs";
import { databaseIdSchema } from "../../assets/shared/schemas/identifiers.ts";
import {
  sessionPresentationVersionsSchema,
  sessionPresentationVersionResponseSchema,
  SESSION_PRESENTATION_SOURCE_KEY_HEADER,
  SESSION_PRESENTATION_SOURCE_DIGEST_HEADER,
  sessionPresentationSourceKeySchema,
} from "../../assets/shared/schemas/session-presentation-versions.ts";
import { publicSessionMediaUrlSchema } from "../../assets/shared/schemas/event-session-history.ts";
import {
  PRESENTATION_FILE_NAME_HEADER,
  PRESENTATION_FILE_SIZE_HEADER,
} from "../../assets/shared/presentation-upload.ts";
const assetSchema = z.object({
  kind: z.literal("presentation"),
  authoredReference: z.string().min(1),
  relativePath: z.string().min(1),
  publicUrl: publicSessionMediaUrlSchema,
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
});
const reportSchema = z.object({
  sourcePath: sessionPresentationSourceKeySchema,
  assets: z.array(assetSchema).max(1000),
});
const receiptSchema = z.object({
  sourcePath: sessionPresentationSourceKeySchema,
  authoredReference: z.string(),
  publicUrl: publicSessionMediaUrlSchema,
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  occurrenceId: databaseIdSchema,
  sourceKey: sessionPresentationSourceKeySchema,
  state: z.enum(["pending", "uploaded"]),
  versionId: databaseIdSchema.optional(),
});
export const agendaMediaStateSchema = z.object({
  baseUrl: z.string(),
  eventSlug: z.string(),
  receipts: z.array(receiptSchema).max(1000),
});
const inside = (root, path) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};
/** @typedef {import('zod').infer<typeof agendaMediaStateSchema>} State */
/** @typedef {{sourcePath:string,authoredReference:string,relativePath:string,publicUrl:string,sourceDigest:string,bytes:number,occurrenceId:string,filePath:string,sourceKey:string}} Asset */
/** Every file must be reverified before any network mutation. Explicit mappings never infer a destination from a title. */
export async function prepareAgendaMediaUpload(reportInput, mappingInput, repositoryRoot) {
  const report = reportSchema.parse(reportInput),
    mappings = z.record(z.string(), databaseIdSchema).parse(mappingInput);
  const root = await realpath(repositoryRoot),
    source = resolve(root, report.sourcePath),
    eventRoot = resolve(source, "..");
  if (!inside(root, source) || !inside(root, await realpath(eventRoot)))
    throw new Error("Source escapes the repository.");
  /** @type {Asset[]} */ const assets = [];
  const identities = new Set();
  for (const asset of report.assets) {
    const occurrenceId = mappings[asset.authoredReference];
    if (!occurrenceId) throw new Error("Map every resolved presentation to a canonical occurrence before upload.");
    const filePath = resolve(eventRoot, asset.relativePath);
    if (!inside(eventRoot, filePath) || !inside(eventRoot, await realpath(filePath)))
      throw new Error("PDF escapes the event source directory.");
    const evidence = await digestPdf(filePath);
    if (evidence.bytes !== asset.bytes || evidence.sourceDigest !== asset.sourceDigest)
      throw new Error("PDF differs from its reviewed preparation evidence.");
    const identity = `${occurrenceId}:${asset.sourceDigest}`;
    if (identities.has(identity)) throw new Error("Map a PDF only once per occurrence.");
    identities.add(identity);
    assets.push({
      ...asset,
      sourcePath: report.sourcePath,
      occurrenceId,
      filePath,
      sourceKey: sessionPresentationSourceKeySchema.parse(relative(root, filePath).split(sep).join("/")),
    });
  }
  return assets;
}
/** Bound downloads/uploads even if a source changes after review. */
async function boundedBytes(stream, expected) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > expected) throw new Error("PDF exceeds its reviewed size.");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (size !== expected) throw new Error("PDF size changed.");
  return bytes;
}
/**
 * Uses the existing private version API and its compensated R2 lifecycle. No material approval or public link replacement.
 * @param {{baseUrl:string,eventSlug:string,token?:string,assets:Asset[],state?:State,apply?:boolean,fetcher?:typeof fetch,saveState?:(state:State)=>Promise<void>}} options
 */
export async function importAgendaMedia(options) {
  const origin = new URL(options.baseUrl);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
  )
    throw new Error("Use an HTTPS origin or local HTTP origin without credentials or a path.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(options.eventSlug)) throw new Error("Choose a valid event slug.");
  const state = agendaMediaStateSchema.parse(
    options.state ?? { baseUrl: origin.origin, eventSlug: options.eventSlug, receipts: [] },
  );
  if (state.baseUrl !== origin.origin || state.eventSlug !== options.eventSlug)
    throw new Error("Receipts belong to a different destination.");
  if (!options.apply) return { state, planned: options.assets.length, uploaded: 0, reconciled: 0, applied: false };
  if (!options.token || /[\r\n]/u.test(options.token) || !options.saveState)
    throw new Error("Applying requires an authentication token and durable receipt storage.");
  const fetcher = options.fetcher ?? fetch;
  const headers = { authorization: `Bearer ${options.token}` };
  let uploaded = 0,
    reconciled = 0;
  for (const asset of options.assets) {
    let receipt = state.receipts.find(
      (row) =>
        row.occurrenceId === asset.occurrenceId &&
        row.sourceKey === asset.sourceKey &&
        row.sourceDigest === asset.sourceDigest,
    );
    const base = `${origin.origin}/api/v1/events/${encodeURIComponent(options.eventSlug)}/agenda/occurrences/${asset.occurrenceId}/materials/presentations`;
    const listed = await fetcher(`${base}?limit=200&offset=0`, { headers, redirect: "error" });
    if (!listed.ok) throw new Error("Could not reconcile presentation versions.");
    const page = sessionPresentationVersionsSchema.parse(await listed.json());
    const existing = page.versions.find(
      (version) =>
        !version.deletedAt && version.sourceKey === asset.sourceKey && version.sourceDigest === asset.sourceDigest,
    );
    if (existing) {
      if (!receipt) {
        receipt = { ...asset, state: "uploaded", versionId: existing.id };
        state.receipts.push(receipt);
      }
      receipt.state = "uploaded";
      receipt.versionId = existing.id;
      await options.saveState(agendaMediaStateSchema.parse(state));
      reconciled++;
      continue;
    }
    const bytes = await boundedBytes(
      createReadStream(asset.filePath, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }),
      asset.bytes,
    );
    if (
      bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sourceDigest
    )
      throw new Error("PDF changed before upload.");
    if (!receipt) {
      receipt = { ...asset, state: "pending" };
      state.receipts.push(receipt);
    }
    receipt.state = "pending";
    delete receipt.versionId;
    await options.saveState(agendaMediaStateSchema.parse(state));
    const response = await fetcher(base, {
      method: "POST",
      redirect: "error",
      headers: {
        ...headers,
        "content-type": "application/pdf",
        [PRESENTATION_FILE_NAME_HEADER]: encodeURIComponent(basename(asset.relativePath)),
        [PRESENTATION_FILE_SIZE_HEADER]: String(asset.bytes),
        [SESSION_PRESENTATION_SOURCE_KEY_HEADER]: encodeURIComponent(asset.sourceKey),
        [SESSION_PRESENTATION_SOURCE_DIGEST_HEADER]: asset.sourceDigest,
      },
      body: bytes,
    });
    if (!response.ok)
      throw new Error(`Upload refused with HTTP ${response.status}. Resume to reconcile before retrying.`);
    const result = sessionPresentationVersionResponseSchema.parse(await response.json());
    if (
      result.version.occurrenceId !== asset.occurrenceId ||
      result.version.fileSize !== asset.bytes ||
      result.version.sourceKey !== asset.sourceKey ||
      result.version.sourceDigest !== asset.sourceDigest
    )
      throw new Error("Upload receipt differs from the destination or reviewed size.");
    receipt.state = "uploaded";
    receipt.versionId = result.version.id;
    await options.saveState(agendaMediaStateSchema.parse(state));
    uploaded++;
  }
  return {
    state: agendaMediaStateSchema.parse(state),
    planned: options.assets.length,
    uploaded,
    reconciled,
    applied: true,
  };
}
