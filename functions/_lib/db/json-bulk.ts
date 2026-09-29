import { stringifyJson } from "../utils/json";

/** Stay below D1's 2 MB bound-value limit while leaving encoding overhead headroom. */
export const D1_JSON_BIND_MAX_BYTES = 1_500_000;
export const D1_JSON_BULK_MAX_ROWS = 500;

const textEncoder = new TextEncoder();

export interface JsonBulkChunk<T> {
  rows: T[];
  json: string;
}

/**
 * Chunks rows for a `json_each(?)` statement by both row count and UTF-8
 * bound-value size. Centralizing this keeps every D1 bulk writer within the
 * same limits instead of relying on statement-count batching.
 */
export function chunkJsonRows<T>(rows: T[], options: { maxRows?: number; maxBytes?: number } = {}): JsonBulkChunk<T>[] {
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? D1_JSON_BULK_MAX_ROWS));
  const maxBytes = Math.max(3, Math.floor(options.maxBytes ?? D1_JSON_BIND_MAX_BYTES));
  const chunks: JsonBulkChunk<T>[] = [];
  let chunkRows: T[] = [];
  let serializedRows: string[] = [];
  let chunkBytes = 2; // JSON array brackets.

  const flush = (): void => {
    if (chunkRows.length === 0) return;
    chunks.push({ rows: chunkRows, json: `[${serializedRows.join(",")}]` });
    chunkRows = [];
    serializedRows = [];
    chunkBytes = 2;
  };

  for (const row of rows) {
    const serialized = stringifyJson(row);
    const rowBytes = textEncoder.encode(serialized).byteLength;
    if (rowBytes + 2 > maxBytes) {
      throw new Error(`JSON row exceeds the ${maxBytes}-byte D1 bulk-insert limit`);
    }

    const separatorBytes = chunkRows.length === 0 ? 0 : 1;
    if (chunkRows.length >= maxRows || (chunkRows.length > 0 && chunkBytes + separatorBytes + rowBytes > maxBytes)) {
      flush();
    }
    chunkRows.push(row);
    serializedRows.push(serialized);
    chunkBytes += (chunkRows.length === 1 ? 0 : 1) + rowBytes;
  }

  flush();
  return chunks;
}
