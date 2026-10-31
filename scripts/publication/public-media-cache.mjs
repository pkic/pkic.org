import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** @typedef {Map<string, Pick<import("@cloudflare/workers-types").R2Object, "etag" | "size">>} PublicMediaManifest */

function missingSource() {
  const error = new Error("A published image source is missing from R2");
  error.name = "MissingPublishedImageSource";
  return error;
}

/**
 * Revalidate approved derivatives through R2 without transferring unchanged bodies.
 * @param {PublicMediaManifest} [manifest]
 */
export async function publicMediaCache(directory, revision, getObject, manifest = undefined) {
  await mkdir(directory, { recursive: true });
  const stats = { reused: 0, downloaded: 0, downloadedBytes: 0 };
  async function atomicWrite(file, bytes) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  }
  return {
    stats,
    async read(key) {
      const entry = resolve(directory, `${digest(`${revision}:${key}`)}.json`);
      let cached;
      try {
        const metadata = JSON.parse(await readFile(entry, "utf8"));
        if (typeof metadata?.etag === "string" && /^[a-f0-9]{64}\.(svg|webp)$/.test(metadata.filename)) {
          const bytes = await readFile(resolve(directory, metadata.filename));
          if (digest(bytes) === metadata.filename.split(".")[0]) cached = { ...metadata, bytes };
        }
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      const listed = manifest?.get(key);
      if (manifest && !listed) throw missingSource();
      if (cached && listed?.etag === cached.etag) {
        stats.reused++;
        return { cached };
      }
      const condition = listed
        ? { onlyIf: { etagMatches: listed.etag } }
        : cached
          ? { onlyIf: { etagDoesNotMatch: cached.etag } }
          : undefined;
      const object = await getObject(key, condition);
      if (!object) throw missingSource();
      if (cached && typeof object.arrayBuffer !== "function" && object.etag === cached.etag) {
        stats.reused++;
        return { cached };
      }
      if (typeof object.arrayBuffer !== "function") throw new Error("R2 returned no body for a changed image");
      stats.downloaded++;
      stats.downloadedBytes += object.size;
      return {
        object,
        async store(bytes, extension) {
          if (!object.etag) return;
          const filename = `${digest(bytes)}.${extension}`;
          await atomicWrite(resolve(directory, filename), bytes);
          await atomicWrite(entry, JSON.stringify({ etag: object.etag, filename }));
        },
      };
    },
  };
}

const PUBLISHED_MEDIA = /\/_published\/media\/([a-f0-9]{64}\.(?:svg|webp))(?=")/g;

/**
 * Stage the published media a snapshot already refers to, from the derivatives the cache holds.
 *
 * A synthetic snapshot is often an earlier release's snapshot with a few records changed. Its images are published
 * paths that the earlier build derived from R2 and kept in this cache under the same content-addressed names, so the
 * new build serves exactly those bytes. A path the cache no longer holds is an error rather than a broken image.
 */
export async function stageCachedPublishedMedia(snapshot, directory, outputs) {
  const filenames = new Set([...JSON.stringify(snapshot).matchAll(PUBLISHED_MEDIA)].map((match) => match[1]));
  for (const filename of filenames) {
    const bytes = await readFile(resolve(directory, filename)).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!bytes || digest(bytes) !== filename.split(".")[0])
      throw new Error(`The snapshot refers to /_published/media/${filename}, which no earlier build derived`);
    for (const output of outputs) {
      await mkdir(resolve(output, "_published", "media"), { recursive: true });
      await writeFile(resolve(output, "_published", "media", filename), bytes);
    }
  }
  return filenames.size;
}
