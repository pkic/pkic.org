import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Revalidate approved derivatives through R2 without transferring unchanged bodies. */
export async function publicMediaCache(directory, revision, getObject) {
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
      const object = await getObject(key, cached ? { onlyIf: { etagDoesNotMatch: cached.etag } } : undefined);
      if (!object) throw new Error("A published image source is missing from R2");
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
