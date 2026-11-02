import type { R2GetOptions } from "@cloudflare/workers-types";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { publicMediaCache, stageCachedPublishedMedia } from "../../scripts/publication/public-media-cache.mjs";

it("conditionally reuses derivatives and downloads only changed or uncached objects", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "pkic-media-cache-"));
  let etag = "original";
  let exists = true;
  const body = vi.fn(async () => Buffer.from(etag));
  const getObject = vi.fn(async (_key: string, options?: R2GetOptions) => {
    if (!exists) return null;
    return options?.onlyIf && "etagDoesNotMatch" in options.onlyIf && options.onlyIf.etagDoesNotMatch === etag
      ? { etag, size: 8 }
      : { etag, size: 8, arrayBuffer: body };
  });
  try {
    const cache = await publicMediaCache(directory, "processor-v1", getObject);
    const cold = await cache.read("private/image");
    if (!cold.object || !cold.store) throw new Error("Expected an uncached body");
    await cold.object.arrayBuffer();
    await cold.store(Buffer.from("sanitized-original"), "svg");
    const warm = await cache.read("private/image");
    expect(warm.cached.bytes.toString()).toBe("sanitized-original");
    expect(getObject).toHaveBeenLastCalledWith("private/image", { onlyIf: { etagDoesNotMatch: "original" } });
    expect(body).toHaveBeenCalledOnce();
    etag = "updated";
    const changed = await cache.read("private/image");
    expect(changed.cached).toBeUndefined();
    if (!changed.object || !changed.store) throw new Error("Expected a changed body");
    await changed.object.arrayBuffer();
    await changed.store(Buffer.from("sanitized-updated"), "svg");
    expect((await cache.read("private/image")).cached.bytes.toString()).toBe("sanitized-updated");
    expect(body).toHaveBeenCalledTimes(2);
    const revised = await publicMediaCache(directory, "processor-v2", getObject);
    expect((await revised.read("private/image")).cached).toBeUndefined();
    expect(getObject).toHaveBeenLastCalledWith("private/image", undefined);
    exists = false;
    await expect(cache.read("private/image")).rejects.toThrow("missing from R2");
    exists = true;
    await rm(directory, { recursive: true });
    const restored = await publicMediaCache(directory, "processor-v1", getObject);
    expect((await restored.read("private/image")).cached).toBeUndefined();
    expect(getObject).toHaveBeenLastCalledWith("private/image", undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("uses the listing manifest to reuse images without individual R2 requests", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "pkic-media-manifest-"));
  const getObject = vi.fn(async () => ({ etag: "v1", size: 8, arrayBuffer: async () => Buffer.from("original") }));
  const manifest = new Map([["private/image", { etag: "v1", size: 8 }]]);
  try {
    const cache = await publicMediaCache(directory, "processor-v1", getObject, manifest);
    const cold = await cache.read("private/image");
    if (!cold.store) throw new Error("Expected a cold cache");
    await cold.store(Buffer.from("optimized"), "svg");
    expect(getObject).toHaveBeenCalledOnce();
    expect(getObject).toHaveBeenLastCalledWith("private/image", { onlyIf: { etagMatches: "v1" } });
    expect((await cache.read("private/image")).cached.bytes.toString()).toBe("optimized");
    expect(getObject).toHaveBeenCalledOnce();
    manifest.delete("private/image");
    await expect(cache.read("private/image")).rejects.toThrow("missing from R2");
    expect(getObject).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("stages the published media a snapshot refers to from the derivatives earlier builds kept", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "pkic-media-restage-"));
  const cacheDirectory = resolve(directory, "cache");
  const getObject = vi.fn(async () => ({ etag: "v1", size: 8, arrayBuffer: async () => Buffer.from("original") }));
  try {
    const cache = await publicMediaCache(cacheDirectory, "processor-v1", getObject);
    const cold = await cache.read("private/image");
    if (!cold.store) throw new Error("Expected a cold cache");
    await cold.store(Buffer.from("derived"), "webp");
    const filename = `${createHash("sha256").update("derived").digest("hex")}.webp`;
    const outputs = [resolve(directory, "media"), resolve(directory, "public")];
    const snapshot = { members: [{ logoUrl: `/_published/media/${filename}` }], hero: `/_published/media/${filename}` };
    await expect(stageCachedPublishedMedia(snapshot, cacheDirectory, outputs)).resolves.toBe(1);
    for (const output of outputs)
      expect(await readFile(resolve(output, "_published", "media", filename), "utf8")).toBe("derived");
    await expect(stageCachedPublishedMedia({ logoUrl: "/favicon.svg" }, cacheDirectory, outputs)).resolves.toBe(0);
    const unknown = `${"0".repeat(64)}.webp`;
    await expect(
      stageCachedPublishedMedia({ logoUrl: `/_published/media/${unknown}` }, cacheDirectory, outputs),
    ).rejects.toThrow(`/_published/media/${unknown}, which no earlier build derived`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
