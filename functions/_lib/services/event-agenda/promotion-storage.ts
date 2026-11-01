/** R2 requires known-length writes; multipart preserves bounded memory for ZIP streams. */
export async function storePromotionArtifact(
  bucket: R2Bucket,
  key: string,
  body: Uint8Array | ReadableStream<Uint8Array>,
  options: R2PutOptions,
): Promise<void> {
  if (body instanceof Uint8Array) {
    await bucket.put(key, body, options);
    return;
  }
  const upload = await bucket.createMultipartUpload(key, options);
  const reader = body.getReader();
  const parts: R2UploadedPart[] = [];
  const partSize = 5 * 1024 * 1024;
  let buffer = new Uint8Array(partSize);
  let used = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      let offset = 0;
      while (offset < next.value.length) {
        const count = Math.min(partSize - used, next.value.length - offset);
        buffer.set(next.value.subarray(offset, offset + count), used);
        used += count;
        offset += count;
        if (used === partSize) {
          parts.push(await upload.uploadPart(parts.length + 1, buffer));
          buffer = new Uint8Array(partSize);
          used = 0;
        }
      }
    }
    if (used || !parts.length) parts.push(await upload.uploadPart(parts.length + 1, buffer.subarray(0, used)));
    await upload.complete(parts);
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await upload.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
