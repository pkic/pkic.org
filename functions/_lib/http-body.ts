import { AppError } from "./errors";

export const STRIPE_WEBHOOK_MAX_BYTES = 1024 * 1024;
export const SENDGRID_WEBHOOK_MAX_BYTES = 2 * 1024 * 1024;

function declaredContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new AppError(400, "INVALID_CONTENT_LENGTH", "Invalid Content-Length header");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError(400, "INVALID_CONTENT_LENGTH", "Invalid Content-Length header");
  return parsed;
}

/**
 * Reads an untrusted request body without ever retaining more than maxBytes.
 * The Content-Length check is an optimization only; the streaming counter is
 * the authoritative control for chunked or dishonest requests.
 */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  const declared = declaredContentLength(request);
  if (declared !== null && declared > maxBytes) {
    throw new AppError(413, "REQUEST_BODY_TOO_LARGE", "Request body must not exceed " + maxBytes + " bytes");
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body exceeds configured limit").catch(() => undefined);
        throw new AppError(413, "REQUEST_BODY_TOO_LARGE", "Request body must not exceed " + maxBytes + " bytes");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedTextBody(request: Request, maxBytes: number): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, maxBytes));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_UTF8", "Request body must be valid UTF-8");
  }
}
