import { AppError, isAppError } from "../errors";
import { readBoundedMultipartFormData } from "../http-body";

export const MAX_ICS_BYTES = 2 * 1024 * 1024; // 2 MB — text calendar files are small

export interface UploadedIcsFile {
  buffer: ArrayBuffer;
  contentType: string;
  label: string;
  year: number;
}

/** Calendar uploads are executable inputs to calendar clients; validate the
 * bytes, not the browser-supplied filename or MIME type. */
export function validateIcsBytes(buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer);
  if (bytes.includes(0)) {
    throw new AppError(400, "INVALID_ICS_FILE", "Calendar file must be UTF-8 text, not binary data");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .trim();
  } catch {
    throw new AppError(400, "INVALID_ICS_FILE", "Calendar file must be valid UTF-8 text");
  }
  if (!text.startsWith("BEGIN:VCALENDAR") || !text.endsWith("END:VCALENDAR")) {
    throw new AppError(400, "INVALID_ICS_FILE", "File is not a complete iCalendar document");
  }
}

/**
 * Reads a staff-uploaded ICS file plus its 'label'/'year' metadata from a
 * multipart/form-data request ("label e.g. '09:00 CET', R2
 * upload, year"). Mirrors readUploadedImage (image-upload.ts)'s
 * eager-arrayBuffer-first pattern to avoid the same Wrangler dev stream-drop
 * issue, but requires multipart (unlike image uploads there's no bare-binary
 * fallback, since label/year have nowhere else to travel).
 */
export async function readUploadedIcsFile(request: Request): Promise<UploadedIcsFile> {
  const reqContentType = request.headers.get("content-type") || "";
  if (!reqContentType.includes("multipart/form-data")) {
    throw new AppError(400, "INVALID_CONTENT_TYPE", "Request must be multipart/form-data with file/label/year fields");
  }

  let formData: FormData;
  try {
    formData = await readBoundedMultipartFormData(request, MAX_ICS_BYTES);
  } catch (error) {
    if (isAppError(error) && error.code === "REQUEST_BODY_TOO_LARGE") {
      throw new AppError(413, "FILE_TOO_LARGE", `ICS file must be under ${MAX_ICS_BYTES / (1024 * 1024)} MB`);
    }
    if (isAppError(error)) throw error;
    throw new AppError(400, "BODY_READ_ERROR", "Failed to receive upload body");
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    throw new AppError(400, "MISSING_FILE", "A 'file' field is required.");
  }

  const label = formData.get("label");
  if (typeof label !== "string" || !label.trim()) {
    throw new AppError(400, "MISSING_LABEL", "A 'label' field is required.");
  }

  const yearRaw = formData.get("year");
  const year = typeof yearRaw === "string" ? Number.parseInt(yearRaw, 10) : NaN;
  if (!Number.isInteger(year)) {
    throw new AppError(400, "MISSING_YEAR", "A numeric 'year' field is required.");
  }

  const fileBuffer = await file.arrayBuffer();
  if (fileBuffer.byteLength > MAX_ICS_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", `ICS file must be under ${MAX_ICS_BYTES / (1024 * 1024)} MB`);
  }
  validateIcsBytes(fileBuffer);
  return { buffer: fileBuffer, contentType: file.type || "text/calendar", label: label.trim(), year };
}
