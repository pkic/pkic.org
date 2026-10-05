import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { storePromotionArtifact } from "../functions/_lib/services/event-agenda/promotion-storage";

describe("promotion stream storage", () => {
  it("stores an unknown-length multi-part stream in real R2 with its metadata and complete bytes", async () => {
    const bucket = env.ASSETS_BUCKET;
    if (!bucket) throw new Error("Synthetic R2 binding missing");
    const size = 5 * 1024 * 1024 + 31;
    const body = new Uint8Array(size).fill(71);
    body[0] = 80;
    body[size - 1] = 19;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body.subarray(0, 8191));
        controller.enqueue(body.subarray(8191));
        controller.close();
      },
    });
    const key = `promotion-storage/${crypto.randomUUID()}.zip`;
    await storePromotionArtifact(bucket, key, stream, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { agendaRevision: "3" },
    });
    const stored = await bucket.get(key);
    expect(stored?.size).toBe(size);
    expect(stored?.httpMetadata?.contentType).toBe("application/zip");
    expect(stored?.customMetadata?.agendaRevision).toBe("3");
    const bytes = new Uint8Array(await stored!.arrayBuffer());
    expect(bytes.length).toBe(body.length);
    expect(bytes.every((byte, index) => byte === body[index])).toBe(true);
    await bucket.delete(key);
  });
  it("aborts failed streams so incomplete artifacts are never committed", async () => {
    const bucket = env.ASSETS_BUCKET;
    if (!bucket) throw new Error("Synthetic R2 binding missing");
    const key = `promotion-storage/${crypto.randomUUID()}.zip`;
    let count = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!count++) controller.enqueue(new Uint8Array(5 * 1024 * 1024));
        else controller.error(new Error("Synthetic render failure"));
      },
    });
    await expect(storePromotionArtifact(bucket, key, stream, {})).rejects.toThrow("Synthetic render failure");
    expect(await bucket.get(key)).toBeNull();
  });
});
