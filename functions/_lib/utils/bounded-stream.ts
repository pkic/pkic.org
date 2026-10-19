export type BoundedStreamReadResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" };

/** Reads a byte stream up to an inclusive limit without retaining an oversized body. */
export async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  cancelReason = "stream exceeds configured limit",
  signal?: AbortSignal,
): Promise<BoundedStreamReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  if (!stream) {
    signal?.throwIfAborted();
    return { ok: true, bytes: new Uint8Array() };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancellation: Promise<void> | undefined;
  const cancelReader = (reason: unknown) => {
    cancellation ??= reader.cancel(reason).catch(() => undefined);
    return cancellation;
  };
  const abort = () => {
    void cancelReader(signal?.reason);
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelReader(cancelReason);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
    await cancellation;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
