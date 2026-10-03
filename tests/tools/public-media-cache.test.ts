import type { R2GetOptions } from "@cloudflare/workers-types";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { publicMediaCache } from "../../scripts/publication/public-media-cache.mjs";

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
