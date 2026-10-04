/** Read object versions in paginated bucket listings, retaining only approved keys. */
export async function listPublicMedia(keys, bucketForKey) {
  const buckets = new Map();
  for (const key of new Set(keys)) {
    const bucket = bucketForKey(key);
    if (!buckets.has(bucket)) buckets.set(bucket, new Set());
    buckets.get(bucket).add(key);
  }
  const manifest = new Map();
  let requests = 0;
  for (const [bucket, remaining] of buckets) {
    let cursor;
    do {
      const page = await bucket.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
      requests++;
      for (const object of page.objects) {
        if (remaining.delete(object.key)) manifest.set(object.key, { etag: object.etag, size: object.size });
      }
      if (!page.truncated || remaining.size === 0) break;
      if (!page.cursor || page.cursor === cursor) throw new Error("R2 media listing did not advance");
      cursor = page.cursor;
    } while (cursor && remaining.size > 0);
  }
  console.log(`[publication] R2 media manifest: ${manifest.size} approved objects, ${requests} listing requests`);
  return manifest;
}
