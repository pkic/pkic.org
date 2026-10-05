import { createHash } from "node:crypto";
import { MAX_PRESENTATION_BYTES } from "../../assets/shared/presentation-upload.ts";
/**
 * Verify selected private R2 bytes without copying them into Static Assets.
 * @param {import('../../functions/_lib/services/site-publication-documents').PublishedDocument[]} documents
 * @param {(key:string)=>Promise<{size:number,etag:string,body:ReadableStream<Uint8Array>}|null>} getObject
 * @returns {Promise<import('../../functions/_lib/services/site-publication-documents').VerifiedPublishedDocument[]>}
 */
export async function verifyPublicDocuments(documents, getObject) {
  /** @type {import('../../functions/_lib/services/site-publication-documents').VerifiedPublishedDocument[]} */
  const verified = [];
  for (const document of documents) {
    if (
      !Number.isSafeInteger(document.fileSize) ||
      document.fileSize <= 0 ||
      document.fileSize > MAX_PRESENTATION_BYTES
    )
      throw new Error("Published PDF source exceeds the presentation upload limit");
    const object = await getObject(document.r2Key);
    if (!object || !object.etag || object.size !== document.fileSize)
      throw new Error("Published PDF source is missing or has changed size");
    const reader = object.body.getReader(),
      hash = createHash("sha256");
    const prefix = new Uint8Array(5);
    let size = 0,
      prefixLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > document.fileSize) throw new Error("Published PDF source exceeds its verified size");
        if (prefixLength < 5) {
          const bytes = value.subarray(0, 5 - prefixLength);
          prefix.set(bytes, prefixLength);
          prefixLength += bytes.length;
        }
        hash.update(value);
      }
      if (
        size !== document.fileSize ||
        new TextDecoder().decode(prefix) !== "%PDF-" ||
        hash.digest("hex") !== document.digest
      )
        throw new Error("Published PDF source does not match its verified content digest");
      verified.push({ ...document, objectEtag: object.etag });
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return verified;
}
