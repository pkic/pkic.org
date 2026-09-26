export type BoundedStreamReadResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" };

/** Reads a byte stream up to an inclusive limit without retaining an oversized body. */
export async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  cancelReason = "stream exceeds configured limit",
): Promise<BoundedStreamReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  if (!stream) return { ok: true, bytes: new Uint8Array() };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(cancelReason).catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
