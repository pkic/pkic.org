import { AppError } from "../errors";

export const MAX_ICS_BYTES = 2 * 1024 * 1024; // 2 MB — text calendar files are small

export interface UploadedIcsFile {
  buffer: ArrayBuffer;
  contentType: string;
  label: string;
  year: number;
}

/**
 * Reads a staff-uploaded ICS file plus its 'label'/'year' metadata from a
 * multipart/form-data request (PRD §4.12 "label e.g. '09:00 CET', R2
 * upload, year"). Mirrors readUploadedImage (headshot-upload.ts)'s
 * eager-arrayBuffer-first pattern to avoid the same Wrangler dev stream-drop
 * issue, but requires multipart (unlike image uploads there's no bare-binary
 * fallback, since label/year have nowhere else to travel).
 */
export async function readUploadedIcsFile(request: Request): Promise<UploadedIcsFile> {
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await request.arrayBuffer();
  } catch {
    throw new AppError(400, "BODY_READ_ERROR", "Failed to receive upload body");
  }

  const reqContentType = request.headers.get("content-type") || "";
  if (!reqContentType.includes("multipart/form-data")) {
    throw new AppError(400, "INVALID_CONTENT_TYPE", "Request must be multipart/form-data with file/label/year fields");
  }

  const boundaryMatch = reqContentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch ? boundaryMatch[1] || boundaryMatch[2] : "";
  if (!boundary) throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart boundary");

  const formData = await new Response(arrayBuffer, { headers: { "Content-Type": reqContentType } }).formData();

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
  return { buffer: fileBuffer, contentType: file.type || "text/calendar", label: label.trim(), year };
}
