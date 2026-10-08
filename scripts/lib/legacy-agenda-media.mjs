import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { contentMediaUrl } from "../../assets/shared/content-media-url.ts";
import { youtubeStartOffset } from "../../assets/shared/markdown-media.ts";
import { publicSessionMediaUrlSchema } from "../../assets/shared/schemas/event-session-history.ts";

/**
 * @typedef {{presentation?: string, youtube?: string}} LegacyMediaSession
 * @typedef {{sessions?: LegacyMediaSession[] | null}} LegacyMediaSlot
 * @typedef {{agenda?: Record<string, LegacyMediaSlot[]>}} LegacyMediaSource
 * @typedef {Object} LegacyMediaOptions
 * @property {string} sourcePath
 * @property {Record<string, string>} [presentationUrls]
 * @property {Record<string, string>} [recordingUrls]
 * @property {Record<string, {relativePath:string,sourceDigest:string,bytes:number}>} [localPresentationFiles]
 * @property {string} [publicBasePath]
 * @property {string} [contentRoot]
 * @typedef {Object} LegacyMediaFinding
 * @property {"media"} kind
 * @property {"presentation" | "recording"} mediaKind
 * @property {string} authoredReference
 * @property {string} reason
 * @typedef {Object} LegacyMediaAsset
 * @property {"presentation"} kind
 * @property {string} authoredReference
 * @property {string} relativePath
 * @property {string} publicUrl
 * @property {string} sourceDigest
 * @property {number} bytes
 * @typedef {Object} LegacyMediaInventory
 * @property {Record<string, string>} presentationUrls
 * @property {Record<string, string>} recordingUrls
 * @property {Record<string, string>} mediaDigests
 * @property {LegacyMediaFinding[]} unresolved
 * @property {LegacyMediaAsset[]} assets
 */

const MAX_REFERENCES = 10000;
const MAX_FILES = 5000;
const MAX_DEPTH = 8;
const MAX_BYTES = 25 * 1024 * 1024;
const inside = (root, path) => {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === "" || (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
};

/**
 * Legacy IDs may carry a recording offset; arbitrary query strings are never inferred.
 * @param {unknown} reference
 * @returns {string | null}
 */
export function canonicalLegacyRecordingUrl(reference) {
  if (typeof reference !== "string") return null;
  const match = /^([A-Za-z0-9_-]{11})(?:\?start=(.*))?$/u.exec(reference);
  if (match) {
    const offset = match[2] === undefined ? null : youtubeStartOffset(match[2]);
    if (match[2] !== undefined && offset === null) return null;
    return `https://www.youtube.com/watch?v=${match[1]}${offset === null ? "" : `&start=${offset}`}`;
  }
  return /^https?:\/\//u.test(reference) && publicSessionMediaUrlSchema.safeParse(reference).success ? reference : null;
}

function localPattern(reference) {
  if (
    typeof reference !== "string" ||
    !reference ||
    reference.length > 500 ||
    /[\\%#]/u.test(reference) ||
    [...reference].some((character) => character.charCodeAt(0) < 32)
  )
    return null;
  const parts = reference.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("**"))) return null;
  if (!/\.pdf$/iu.test(reference)) return null;
  const escaped = reference
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]");
  return new RegExp(`^${escaped}$`, "u");
}

async function inventory(directory, root, prefix = "", depth = 0, result = [], budget = { entries: 0 }) {
  if (depth > MAX_DEPTH) throw new Error("Local media directory exceeds the depth limit.");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (++budget.entries > MAX_FILES) throw new Error("Local media directory exceeds the entry limit.");
    if (entry.name.startsWith(".")) continue;
    const path = resolve(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Symlinks are not inventory assets, even when their target happens to be local.
    if (entry.isSymbolicLink()) continue;
    if (!inside(root, await realpath(path))) throw new Error("Local media escapes the event directory.");
    if (entry.isDirectory()) await inventory(path, root, name, depth + 1, result, budget);
    else if (entry.isFile()) {
      result.push(name);
      if (result.length > MAX_FILES) throw new Error("Local media directory exceeds the file limit.");
    }
  }
  return result.sort();
}

export async function digestPdf(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES)
    throw new Error("PDF must be a regular file within the static asset size limit.");
  const hash = createHash("sha256");
  let header = Buffer.alloc(0),
    bytes = 0;
  for await (const chunk of createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("PDF exceeds the static asset size limit.");
    if (header.length < 5) header = Buffer.concat([header, chunk]).subarray(0, 5);
    hash.update(chunk);
  }
  const after = await lstat(path);
  if (header.toString("ascii") !== "%PDF-") throw new Error("Local slide asset is not a PDF.");
  if (
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    bytes !== after.size
  )
    throw new Error("PDF changed while preparing the media inventory.");
  return { sourceDigest: hash.digest("hex"), bytes };
}

/**
 * Local evidence only: resolving a URL does not grant rights, consent, validation or release approval.
 * @param {LegacyMediaSource} source
 * @param {LegacyMediaOptions} options
 * @returns {Promise<LegacyMediaInventory>}
 */
export async function resolveLegacyAgendaMedia(
  source,
  {
    sourcePath,
    presentationUrls = {},
    recordingUrls = {},
    localPresentationFiles = {},
    publicBasePath,
    contentRoot = resolve("content"),
  },
) {
  let referenceCount = 0;
  const presentations = new Set(),
    recordings = new Set();
  for (const slots of Object.values(source.agenda ?? {}))
    for (const slot of slots)
      for (const session of slot.sessions ?? []) {
        if (++referenceCount > MAX_REFERENCES) throw new Error("Agenda exceeds the session media inventory limit.");
        if (session.presentation) presentations.add(session.presentation);
        if (session.youtube) recordings.add(session.youtube);
      }
  if (presentations.size + recordings.size > MAX_REFERENCES)
    throw new Error("Agenda exceeds the media reference limit.");
  /** @type {LegacyMediaInventory} */
  const output = { presentationUrls: {}, recordingUrls: {}, mediaDigests: {}, unresolved: [], assets: [] };
  /** @param {"presentation" | "recording"} kind @param {string} authoredReference @param {string} reason */
  const unresolved = (kind, authoredReference, reason) =>
    output.unresolved.push({ kind: "media", mediaKind: kind, authoredReference, reason });
  const eventRoot = await realpath(dirname(resolve(sourcePath)));
  const root = await realpath(contentRoot);
  const canonicalBase = inside(root, eventRoot)
    ? contentMediaUrl(relative(root, eventRoot).split(sep).join("/"))
    : null;
  const canDerive =
    canonicalBase?.startsWith("/content-media/events/") && publicBasePath?.replace(/\/$/u, "") === canonicalBase;
  let files;
  for (const reference of presentations) {
    const explicit = presentationUrls[reference];
    if (explicit !== undefined && !publicSessionMediaUrlSchema.safeParse(explicit).success) {
      unresolved("presentation", reference, "invalid_public_url");
      continue;
    }
    if (/^https?:\/\//u.test(reference)) {
      const url = explicit ?? reference;
      if (publicSessionMediaUrlSchema.safeParse(url).success) output.presentationUrls[reference] = url;
      else unresolved("presentation", reference, "invalid_public_url");
      continue;
    }
    const localMapping = localPresentationFiles[reference];
    if (
      localMapping &&
      (!localPattern(localMapping.relativePath) ||
        /[?*]/u.test(localMapping.relativePath) ||
        !/^[a-f0-9]{64}$/u.test(localMapping.sourceDigest ?? "") ||
        !Number.isSafeInteger(localMapping.bytes) ||
        localMapping.bytes <= 0)
    ) {
      unresolved("presentation", reference, "invalid_local_mapping");
      continue;
    }
    const pattern = localPattern(reference);
    if (!pattern) {
      unresolved("presentation", reference, "unsafe_local_reference");
      continue;
    }
    files ??= await inventory(eventRoot, eventRoot);
    const matches = files.filter((file) => (localMapping ? file === localMapping.relativePath : pattern.test(file)));
    if (matches.length !== 1) {
      unresolved("presentation", reference, matches.length ? "ambiguous_local_asset" : "missing_local_asset");
      continue;
    }
    if (!explicit && !canDerive) {
      unresolved("presentation", reference, "canonical_public_path_required");
      continue;
    }
    try {
      const path = resolve(eventRoot, matches[0]);
      if (!inside(eventRoot, await realpath(path))) throw new Error("Local asset escapes the event directory.");
      const evidence = await digestPdf(path);
      if (
        localMapping &&
        (localMapping.sourceDigest !== evidence.sourceDigest || localMapping.bytes !== evidence.bytes)
      )
        throw new Error("Reviewed local PDF digest or byte length no longer matches.");
      const publicUrl = explicit ?? contentMediaUrl(`${relative(root, eventRoot).split(sep).join("/")}/${matches[0]}`);
      output.presentationUrls[reference] = publicUrl;
      output.mediaDigests[reference] = evidence.sourceDigest;
      output.assets.push({
        kind: "presentation",
        authoredReference: reference,
        relativePath: matches[0],
        ...(localMapping
          ? {
              localMapping: { ...localMapping },
              originalPublicUrl:
                explicit ?? contentMediaUrl(`${relative(root, eventRoot).split(sep).join("/")}/${reference}`),
            }
          : {}),
        publicUrl,
        ...evidence,
      });
    } catch (error) {
      unresolved("presentation", reference, error.message);
    }
  }
  for (const reference of recordings) {
    const url = recordingUrls[reference] ?? canonicalLegacyRecordingUrl(reference);
    if (!url || !publicSessionMediaUrlSchema.safeParse(url).success)
      unresolved("recording", reference, "invalid_recording_reference");
    else output.recordingUrls[reference] = url;
  }
  return output;
}
