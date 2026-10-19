import { createHash } from "node:crypto";
import { recordingContainerMimeType } from "../../assets/shared/session-recording-container.ts";
/**
 * Independently stream selected private bytes. No video is copied into the public build.
 * @param {import('../../functions/_lib/services/site-publication-recordings').PublishedRecording[]} recordings
 * @param {(key:string,options:{onlyIf:{etagMatches:string}})=>Promise<{size:number,etag:string,body?:ReadableStream<Uint8Array>}|null>} getObject
 * @returns {Promise<import('../../functions/_lib/services/site-publication-recordings').PublishedRecording[]>}
 */
export async function verifyPublicRecordings(recordings, getObject) {
  const verified = [];
  for (const recording of recordings) {
    if (!Number.isSafeInteger(recording.fileSize) || recording.fileSize <= 0 || !recording.objectEtag)
      throw new Error("Published recording lacks its immutable byte identity");
    const object = await getObject(recording.r2Key, { onlyIf: { etagMatches: recording.objectEtag } });
    if (!object?.body || object.size !== recording.fileSize || object.etag !== recording.objectEtag) {
      if (object?.body) await object.body.cancel().catch(() => {});
      throw new Error("Published recording object changed");
    }
    const reader = object.body.getReader(),
      hash = createHash("sha256");
    const prefix = new Uint8Array(Math.min(65536, recording.fileSize));
    let bytes = 0,
      prefixBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > recording.fileSize) throw new Error("Published recording exceeds its verified size");
        const take = Math.min(value.byteLength, prefix.length - prefixBytes);
        prefix.set(value.subarray(0, take), prefixBytes);
        prefixBytes += take;
        hash.update(value);
      }
      if (
        bytes !== recording.fileSize ||
        hash.digest("hex") !== recording.digest ||
        recordingContainerMimeType(prefix.subarray(0, prefixBytes)) !== recording.mimeType
      )
        throw new Error("Published recording does not match its verified digest, size and container");
      verified.push({ ...recording });
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return verified;
}
