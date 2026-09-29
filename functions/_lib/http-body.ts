import { AppError } from "./errors";
import { readBoundedStream } from "./utils/bounded-stream";

export const STRIPE_WEBHOOK_MAX_BYTES = 1024 * 1024;
export const SENDGRID_WEBHOOK_MAX_BYTES = 2 * 1024 * 1024;
export const INTERNAL_CALENDAR_RSVP_MAX_BYTES = 384 * 1024;
export const MULTIPART_OVERHEAD_MAX_BYTES = 256 * 1024;
export const JSON_REQUEST_MAX_BYTES = 2 * 1024 * 1024;
export const MCP_AUTHORIZE_MAX_BYTES = 64 * 1024;
export const LEGACY_FORM_MAX_BYTES = 256 * 1024;

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
  const result = await readBoundedStream(request.body, maxBytes, "request body exceeds configured limit");
  if (!result.ok) {
    throw new AppError(413, "REQUEST_BODY_TOO_LARGE", "Request body must not exceed " + maxBytes + " bytes");
  }
  return result.bytes;
}

export async function readBoundedTextBody(request: Request, maxBytes: number): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, maxBytes));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_UTF8", "Request body must be valid UTF-8");
  }
}

/** Parse JSON only after the shared streaming byte limit has been enforced. */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
  options: { allowEmpty?: boolean } = {},
): Promise<unknown> {
  let text: string;
  try {
    text = await readBoundedTextBody(request, maxBytes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  if (options.allowEmpty && text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

/**
 * Materialize legacy form requests only after one bounded read. This keeps
 * urlencoded and multipart callers on the same request-size boundary.
 */
export async function readBoundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  const lowerContentType = contentType.toLowerCase();
  const bytes = await readBoundedBody(request, maxBytes);

  if (lowerContentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!(boundaryMatch?.[1] || boundaryMatch?.[2])) {
      throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart boundary");
    }
    try {
      return await new Response(bytes.buffer as ArrayBuffer, {
        headers: { "Content-Type": contentType },
      }).formData();
    } catch {
      throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart upload");
    }
  }

  if (lowerContentType.includes("application/x-www-form-urlencoded")) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AppError(400, "INVALID_UTF8", "Request body must be valid UTF-8");
    }
    const formData = new FormData();
    for (const [key, value] of new URLSearchParams(text)) formData.append(key, value);
    return formData;
  }

  throw new AppError(400, "INVALID_CONTENT_TYPE", "Request must be a supported form submission");
}

/**
 * Parses one bounded multipart body without trusting Content-Length. The
 * streaming counter rejects chunked or dishonest requests before FormData
 * parsing can retain an unbounded payload.
 */
export async function readBoundedMultipartFormData(request: Request, maxFileBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new AppError(400, "INVALID_CONTENT_TYPE", "Request must be multipart/form-data");
  }
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!(boundaryMatch?.[1] || boundaryMatch?.[2])) {
    throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart boundary");
  }

  try {
    const bytes = await readBoundedBody(request, maxFileBytes + MULTIPART_OVERHEAD_MAX_BYTES);
    // readBoundedBody owns one exactly-sized Uint8Array, so its backing buffer
    // can be transferred to the parser without a second full-body copy.
    const body = bytes.buffer as ArrayBuffer;
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart upload");
  }
}
