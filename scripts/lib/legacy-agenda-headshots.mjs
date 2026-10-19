import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { siteContentSlug } from "../../assets/shared/site-content-slug.ts";
import { contentMediaUrl } from "../../assets/shared/content-media-url.ts";
import { publicSessionPortraitUrlSchema } from "../../assets/shared/schemas/event-session-history.ts";

/**
 * Source-asset evidence only; no canonical identity matching, rights or upload.
 * @param {{speakers?: {name:string,id?:string}[]}} source
 * @param {{sourcePath:string,contentRoot:string,publicBasePath?:string,historicalPeople?:Record<string,{photoUrl?:string}>,localHeadshotFiles?:Record<string,{relativePath:string,sourceDigest:string,bytes:number,mediaType:"image/png"|"image/jpeg"|"image/webp"}>}} options
 */
export async function resolveLegacyAgendaHeadshots(source, options) {
  if (!source.speakers?.length) return { photoUrls: {}, assets: [], unresolved: [] };
  const eventRoot = await realpath(dirname(resolve(options.sourcePath)));
  const contentRoot = await realpath(options.contentRoot);
  const eventRelative = relative(contentRoot, eventRoot).split(sep).join("/");
  if (eventRelative === ".." || eventRelative.startsWith("../"))
    return {
      photoUrls: {},
      assets: [],
      unresolved: source.speakers.map((speaker) => ({
        sourceRef: speaker.name,
        authoredReference: `speakers/${speaker.id ?? siteContentSlug(speaker.name)}.*`,
        reason: "canonical_public_path_required",
      })),
    };
  const expectedBase = contentMediaUrl(eventRelative);
  const directory = resolve(eventRoot, "speakers");
  /** @type {string[]} */
  let names = [];
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Headshot directory must be a regular local directory.");
    names = (await readdir(directory)).sort();
  } catch (error) {
    if (/** @type {{code?:string}} */ (error).code !== "ENOENT") throw error;
  }
  if (names.length > 5000) throw new Error("Headshot inventory exceeds local file limit.");
  /** @type {{sourceRef:string,reason:string,authoredReference:string}[]} */
  const unresolved = [];
  /** @type {{sourceRef:string,authoredReference:string,relativePath:string,publicUrl:string,originalPublicUrl:string|null,sourceDigest:string,bytes:number}[]} */
  const assets = [];
  /** @type {Record<string,string>} */
  const photoUrls = {};
  const mappings = options.localHeadshotFiles ?? {};
  for (const authoredReference of Object.keys(mappings)) {
    if (
      !(source.speakers ?? []).some(
        (speaker) => authoredReference === `speakers/${speaker.id ?? siteContentSlug(speaker.name)}.*`,
      )
    )
      unresolved.push({ sourceRef: "", authoredReference, reason: "unknown_local_mapping_reference" });
  }
  for (const speaker of source.speakers ?? []) {
    const stem = speaker.id ?? siteContentSlug(speaker.name);
    const authoredReference = `speakers/${stem}.*`;
    const fail = (/** @type {string} */ reason) =>
      unresolved.push({ sourceRef: speaker.name, authoredReference, reason });
    if ((source.speakers ?? []).filter((candidate) => candidate.name === speaker.name).length > 1) {
      fail("ambiguous_authored_speaker");
      continue;
    }
    if (!stem || /[/\\]|^\.{1,2}$/u.test(stem)) {
      fail("unsafe_local_reference");
      continue;
    }
    const localMapping = mappings[authoredReference];
    if (
      localMapping &&
      (!/^speakers\/[^/\\%?#*]+\.(?:png|jpe?g|webp)$/iu.test(localMapping.relativePath ?? "") ||
        [...(localMapping.relativePath ?? "")].some((character) => character.charCodeAt(0) < 32) ||
        !/^[a-f0-9]{64}$/u.test(localMapping.sourceDigest ?? "") ||
        !Number.isSafeInteger(localMapping.bytes) ||
        localMapping.bytes <= 0 ||
        localMapping.bytes > 25 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(localMapping.mediaType))
    ) {
      fail("invalid_local_mapping");
      continue;
    }
    const authoredMatches = names.filter((name) => name.startsWith(`${stem}.`) && /\.(?:png|jpe?g|webp)$/iu.test(name));
    const matches = localMapping
      ? names.filter((name) => `speakers/${name}` === localMapping.relativePath)
      : authoredMatches;
    if (matches.length !== 1) {
      fail(matches.length ? "ambiguous_local_asset" : "missing_local_asset");
      continue;
    }
    const explicit = options.historicalPeople?.[speaker.name]?.photoUrl;
    // A reviewed destination may be a migrated R2 portrait (`/api/v1/users/:id/headshots/:file`).
    if (explicit !== undefined && !publicSessionPortraitUrlSchema.safeParse(explicit).success) {
      fail("invalid_public_url");
      continue;
    }
    if (!explicit && options.publicBasePath?.replace(/\/$/u, "") !== expectedBase) {
      fail("canonical_public_path_required");
      continue;
    }
    const path = resolve(directory, matches[0]);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 25 * 1024 * 1024) {
      fail("unsafe_local_asset");
      continue;
    }
    const hash = createHash("sha256");
    let bytes = 0;
    let header = Buffer.alloc(0);
    for await (const chunk of createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) {
      bytes += chunk.length;
      if (bytes > 25 * 1024 * 1024) throw new Error("Headshot exceeds static asset size limit.");
      if (header.length < 12) header = Buffer.concat([header, chunk]).subarray(0, 12);
      hash.update(chunk);
    }
    const after = await lstat(path);
    const authoredMediaType = /\.png$/iu.test(path)
      ? "image/png"
      : /\.jpe?g$/iu.test(path)
        ? "image/jpeg"
        : "image/webp";
    const mediaType = localMapping?.mediaType ?? authoredMediaType;
    const valid =
      mediaType === "image/png"
        ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mediaType === "image/jpeg"
          ? header.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          : header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
    if (
      !valid ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes !== after.size
    ) {
      fail("invalid_or_changed_local_image");
      continue;
    }
    const sourceDigest = hash.digest("hex");
    if (localMapping && (localMapping.sourceDigest !== sourceDigest || localMapping.bytes !== bytes)) {
      fail("changed_local_mapping_evidence");
      continue;
    }
    const relativePath = `speakers/${matches[0]}`;
    const publicUrl = explicit ?? contentMediaUrl(`${eventRelative}/${relativePath}`);
    assets.push({
      sourceRef: speaker.name,
      authoredReference,
      relativePath,
      publicUrl,
      originalPublicUrl:
        authoredMatches.length === 1 ? contentMediaUrl(`${eventRelative}/speakers/${authoredMatches[0]}`) : null,
      ...(localMapping
        ? {
            localMapping: { ...localMapping },
            mediaType,
            authoredLocalPaths: authoredMatches.map((name) => `speakers/${name}`),
            ...(mediaType !== authoredMediaType
              ? { resolvedSourceFinding: "authored_extension_media_type_mismatch" }
              : {}),
          }
        : {}),
      sourceDigest,
      bytes,
    });
    photoUrls[speaker.name] = publicUrl;
  }
  return { photoUrls, assets, unresolved };
}
