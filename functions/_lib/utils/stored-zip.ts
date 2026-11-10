export interface StoredZipEntry {
  name: string;
  bytes: Uint8Array;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

function findEndRecord(view: DataView): number {
  const last = view.byteLength - END_RECORD_SIZE;
  for (let offset = last; offset >= Math.max(0, last - MAX_COMMENT_SIZE); offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("Archive has no central directory");
}

/**
 * Reads an archive written without compression, in directory order. Sizes come
 * from the central directory because a streamed archive leaves them out of its
 * local headers.
 */
export function readStoredZipEntries(archive: Uint8Array): StoredZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = findEndRecord(view);
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: StoredZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY) throw new Error("Archive directory is malformed");
    if (view.getUint16(cursor + 10, true) !== 0) throw new Error("Archive entry is compressed");
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const headerOffset = view.getUint32(cursor + 42, true);
    const dataOffset =
      headerOffset + 30 + view.getUint16(headerOffset + 26, true) + view.getUint16(headerOffset + 28, true);
    entries.push({
      name: decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength)),
      bytes: archive.subarray(dataOffset, dataOffset + size),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
