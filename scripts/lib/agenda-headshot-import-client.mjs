import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { databaseIdSchema } from "../../assets/shared/schemas/identifiers.ts";
import { STANDARD_HEADSHOT_MAX_BYTES } from "../../assets/shared/schemas/images.ts";
import { userDetailSchema } from "../../assets/shared/schemas/user-management.ts";
import { publicSessionPortraitUrlSchema } from "../../assets/shared/schemas/event-session-history.ts";

const MEDIA_TYPES = /** @type {const} */ (["image/png", "image/jpeg", "image/webp"]);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
/** The preparation report's verified `headshots` inventory (scripts/lib/legacy-agenda-headshots.mjs). */
const reportSchema = z.object({
  sourcePath: z.string().min(1),
  headshots: z.object({
    assets: z
      .array(
        z.object({
          sourceRef: z.string().min(1),
          relativePath: z.string().regex(/^speakers\/[^/\\%?#*]+\.(?:png|jpe?g|webp)$/iu),
          sourceDigest: digestSchema,
          bytes: z.number().int().positive(),
          mediaType: z.enum(MEDIA_TYPES).optional(),
        }),
      )
      .max(5000),
  }),
});
const mappingsSchema = z
  .object({
    speakerUserIds: z.record(z.string(), databaseIdSchema).optional(),
    historicalPeople: z.record(z.string(), z.object({ userId: databaseIdSchema.optional() }).passthrough()).optional(),
  })
  .passthrough();
const receiptSchema = z.object({
  userId: databaseIdSchema,
  sourceRefs: z.array(z.string()).min(1),
  relativePath: z.string(),
  sourceDigest: digestSchema,
  bytes: z.number().int().positive(),
  /** `uploaded` by this tool, or `existing` when the person already had a headshot that was kept. */
  state: z.enum(["pending", "uploaded", "existing"]),
  headshotUrl: publicSessionPortraitUrlSchema.nullable(),
});
export const agendaHeadshotStateSchema = z.object({
  baseUrl: z.string(),
  eventSourcePath: z.string(),
  receipts: z.array(receiptSchema).max(5000),
});
/** Only the fields this tool relies on, from the canonical user detail contract. */
const userHeadshotSchema = z
  .object({ user: userDetailSchema.pick({ id: true, headshotUrl: true }) })
  .transform(({ user }) => user);

const inside = (root, path) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

/** Raster signatures accepted by the headshot upload API. */
function signatureType(header) {
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (header.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Read a confined, non-symlinked file and prove it is the reviewed bytes. */
async function readVerified(filePath, expected) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expected.bytes)
    throw new Error(`Headshot ${expected.relativePath} differs from its preparation evidence.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of createReadStream(filePath, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) {
    size += chunk.length;
    if (size > expected.bytes) throw new Error(`Headshot ${expected.relativePath} grew after review.`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (size !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sourceDigest)
    throw new Error(`Headshot ${expected.relativePath} differs from its preparation evidence.`);
  const mediaType = signatureType(bytes.subarray(0, 12));
  if (!mediaType || (expected.mediaType && expected.mediaType !== mediaType))
    throw new Error(`Headshot ${expected.relativePath} is not the reviewed PNG, JPEG or WebP image.`);
  return { bytes, mediaType };
}

/**
 * @typedef {{userId:string,sourceRefs:string[],relativePath:string,filePath:string,sourceDigest:string,bytes:number}} HeadshotAsset
 * @typedef {{sourceRef:string,reason:string}} HeadshotFinding
 */

/**
 * Verify every inventoried headshot of a canonically mapped speaker before any network request.
 * Source-only credits (no canonical user) keep their authored archive path and are not uploaded.
 * @returns {Promise<{assets:HeadshotAsset[],findings:HeadshotFinding[],sourcePath:string}>}
 */
export async function prepareAgendaHeadshotUpload(reportInput, mappingInput, repositoryRoot) {
  const report = reportSchema.parse(reportInput);
  const mappings = mappingsSchema.parse(mappingInput);
  const root = await realpath(repositoryRoot);
  const source = resolve(root, report.sourcePath);
  const eventRoot = await realpath(dirname(source));
  if (!inside(root, source) || !inside(root, eventRoot)) throw new Error("Source escapes the repository.");
  /** @type {Map<string,HeadshotAsset>} */
  const byUser = new Map();
  /** @type {HeadshotFinding[]} */
  const findings = [];
  const conflicted = new Set();
  for (const asset of report.headshots.assets) {
    const userId = mappings.historicalPeople?.[asset.sourceRef]?.userId ?? mappings.speakerUserIds?.[asset.sourceRef];
    if (!userId) {
      findings.push({ sourceRef: asset.sourceRef, reason: "source_only_credit" });
      continue;
    }
    if (asset.bytes > STANDARD_HEADSHOT_MAX_BYTES) {
      findings.push({ sourceRef: asset.sourceRef, reason: "exceeds_headshot_upload_limit" });
      continue;
    }
    const filePath = resolve(eventRoot, asset.relativePath);
    if (!inside(eventRoot, filePath) || !inside(eventRoot, await realpath(filePath)))
      throw new Error("Headshot escapes the event source directory.");
    await readVerified(filePath, asset);
    const existing = byUser.get(userId);
    if (existing && existing.sourceDigest !== asset.sourceDigest) {
      conflicted.add(userId);
      continue;
    }
    if (existing) existing.sourceRefs.push(asset.sourceRef);
    else
      byUser.set(userId, {
        userId,
        sourceRefs: [asset.sourceRef],
        relativePath: asset.relativePath,
        filePath,
        sourceDigest: asset.sourceDigest,
        bytes: asset.bytes,
        mediaType: asset.mediaType,
      });
  }
  for (const userId of conflicted) {
    for (const sourceRef of byUser.get(userId)?.sourceRefs ?? [])
      findings.push({ sourceRef, reason: "conflicting_portraits_for_one_person" });
    byUser.delete(userId);
  }
  return { assets: [...byUser.values()], findings, sourcePath: report.sourcePath };
}

/**
 * Upload through the existing staff headshot API (`PUT /api/v1/users/:userId/headshot`), which
 * validates, resizes, stores in R2 and commits `users.headshot_r2_key` with its audit and compensation.
 * A person who already has a headshot keeps it; nothing is replaced. Reruns therefore change nothing.
 * @param {{baseUrl:string,token?:string,assets:HeadshotAsset[],sourcePath:string,state?:z.infer<typeof agendaHeadshotStateSchema>,apply?:boolean,fetcher?:typeof fetch,saveState?:(state:z.infer<typeof agendaHeadshotStateSchema>)=>Promise<void>}} options
 */
export async function importAgendaHeadshots(options) {
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
  if (!options.token || /[\r\n]/u.test(options.token))
    throw new Error("Supply the token through PKIC_AGENDA_IMPORT_TOKEN; even a dry run reads current headshots.");
  const state = agendaHeadshotStateSchema.parse(
    options.state ?? { baseUrl: origin.origin, eventSourcePath: options.sourcePath, receipts: [] },
  );
  if (state.baseUrl !== origin.origin || state.eventSourcePath !== options.sourcePath)
    throw new Error("Receipts belong to a different destination or event source.");
  if (options.apply && !options.saveState) throw new Error("Applying requires durable receipt storage.");
  const fetcher = options.fetcher ?? fetch;
  const headers = { authorization: `Bearer ${options.token}` };
  const userUrl = (userId) => `${origin.origin}/api/v1/users/${encodeURIComponent(userId)}`;
  async function currentHeadshot(userId) {
    const response = await fetcher(userUrl(userId), { headers, redirect: "error" });
    if (!response.ok) throw new Error(`Could not read user ${userId}: HTTP ${response.status}.`);
    const user = userHeadshotSchema.parse(await response.json());
    if (user.id !== userId) throw new Error("The user response names a different person.");
    return user.headshotUrl ? publicSessionPortraitUrlSchema.parse(user.headshotUrl) : null;
  }
  const save = async () => options.saveState?.(agendaHeadshotStateSchema.parse(state));
  /** Record one person's receipt (one per user) and persist it before continuing. */
  async function record(asset, fields) {
    const receipt = state.receipts.find((row) => row.userId === asset.userId);
    if (receipt) Object.assign(receipt, pick(asset), fields);
    else state.receipts.push({ ...pick(asset), ...fields });
    await save();
  }
  /** @type {{userId:string,sourceRefs:string[],action:"existing"|"uploaded"|"would_upload",headshotUrl:string|null}[]} */
  const results = [];
  for (const asset of options.assets) {
    const receipt = state.receipts.find((row) => row.userId === asset.userId);
    const current = await currentHeadshot(asset.userId);
    if (current) {
      // Ours only when this tool recorded the upload of these exact bytes; otherwise the person's own photo wins.
      const ours = receipt && receipt.sourceDigest === asset.sourceDigest && receipt.state !== "existing";
      const action = ours ? "uploaded" : "existing";
      if (options.apply) await record(asset, { state: action, headshotUrl: current });
      results.push({ userId: asset.userId, sourceRefs: asset.sourceRefs, action, headshotUrl: current });
      continue;
    }
    if (!options.apply) {
      results.push({ userId: asset.userId, sourceRefs: asset.sourceRefs, action: "would_upload", headshotUrl: null });
      continue;
    }
    const { bytes, mediaType } = await readVerified(asset.filePath, asset);
    await record(asset, { state: "pending", headshotUrl: null });
    const response = await fetcher(`${userUrl(asset.userId)}/headshot`, {
      method: "PUT",
      redirect: "error",
      headers: { ...headers, "content-type": mediaType },
      body: bytes,
    });
    if (!response.ok)
      throw new Error(`Headshot upload for ${asset.userId} refused with HTTP ${response.status}. Rerun to reconcile.`);
    const uploaded = await currentHeadshot(asset.userId);
    if (!uploaded) throw new Error(`User ${asset.userId} has no headshot after upload. Rerun to reconcile.`);
    await record(asset, { state: "uploaded", headshotUrl: uploaded });
    results.push({ userId: asset.userId, sourceRefs: asset.sourceRefs, action: "uploaded", headshotUrl: uploaded });
  }
  return { state: agendaHeadshotStateSchema.parse(state), results };
}

function pick(asset) {
  return {
    userId: asset.userId,
    sourceRefs: [...asset.sourceRefs],
    relativePath: asset.relativePath,
    sourceDigest: asset.sourceDigest,
    bytes: asset.bytes,
  };
}

/**
 * Point each mapped speaker's reviewed historical credit at the person's R2 headshot, so the
 * frozen appearance (and the static build that optimizes it) uses R2 instead of the content tree.
 * A reviewed photoUrl other than an authored `/content-media/` path is left unchanged and reported.
 */
export function mappingsWithHeadshots(mappingInput, results) {
  const mappings = structuredClone(mappingInput);
  /** @type {HeadshotFinding[]} */
  const findings = [];
  let changed = 0;
  for (const result of results) {
    if (!result.headshotUrl) continue;
    for (const sourceRef of result.sourceRefs) {
      const person = mappings.historicalPeople?.[sourceRef];
      if (!person) {
        findings.push({ sourceRef, reason: "no_historical_person_entry" });
        continue;
      }
      if (person.photoUrl === result.headshotUrl) continue;
      if (
        person.photoUrl !== undefined &&
        person.photoUrl !== null &&
        !String(person.photoUrl).startsWith("/content-media/")
      ) {
        findings.push({ sourceRef, reason: "reviewed_photo_url_retained" });
        continue;
      }
      person.photoUrl = result.headshotUrl;
      changed++;
    }
  }
  return { mappings, changed, findings };
}
