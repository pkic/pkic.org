import { AppError } from "../errors";
import { readBoundedBody } from "../http-body";
import { type ImagesBinding } from "../types";
import { IMAGE_UPLOAD_ALLOWED_MIME_TYPES, STANDARD_HEADSHOT_MAX_BYTES } from "../../../assets/shared/schemas/images";

export const ALLOWED_MIME_TYPES = new Set<string>(IMAGE_UPLOAD_ALLOWED_MIME_TYPES);
const MULTIPART_OVERHEAD_MAX_BYTES = 256 * 1024;

function detectedImageContentType(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Robustly reads an uploaded image from a Request, handling both:
 * 1. direct binary POST/PUT (e.g., from the frontend client's fetch API)
 * 2. multipart/form-data (e.g., from Vite/Playwright tests or traditional forms)
 *
 * It eagerly consumes the request body as an ArrayBuffer to prevent stream timeout
 * drops in Wrangler dev when async DB operations follow.
 */
export async function readUploadedImage(
  request: Request,
  maxFileBytes = STANDARD_HEADSHOT_MAX_BYTES,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const reqContentType = request.headers.get("content-type") || "";
  if (reqContentType.includes("multipart/form-data")) {
    const formData = await readBoundedImageMultipartFormData(request, maxFileBytes);
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      throw new AppError(400, "MISSING_FILE", "A 'file' field is required.");
    }
    return { buffer: await file.arrayBuffer(), contentType: file.type };
  }

  let arrayBuffer: ArrayBuffer;
  try {
    const bytes = await readBoundedBody(request, maxFileBytes);
    arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "BODY_READ_ERROR", "Failed to receive upload body");
  }

  if (reqContentType === "application/octet-stream" || reqContentType.startsWith("image/")) {
    return { buffer: arrayBuffer, contentType: reqContentType };
  }

  throw new AppError(400, "INVALID_CONTENT_TYPE", "Request must be multipart/form-data or an image type");
}

export async function readBoundedImageMultipartFormData(request: Request, maxFileBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    throw new AppError(400, "INVALID_CONTENT_TYPE", "Request must be multipart/form-data");
  }
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!(boundaryMatch?.[1] || boundaryMatch?.[2])) {
    throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart boundary");
  }
  try {
    const bytes = await readBoundedBody(request, maxFileBytes + MULTIPART_OVERHEAD_MAX_BYTES);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart upload");
  }
}

/** Reads and validates both declared MIME type and file signature before R2 storage. */
export async function readValidatedUploadedImage(
  request: Request,
  label: "Headshot" | "Logo",
  maxBytes = STANDARD_HEADSHOT_MAX_BYTES,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  let uploaded: { buffer: ArrayBuffer; contentType: string };
  try {
    uploaded = await readUploadedImage(request, maxBytes);
  } catch (error) {
    if (error instanceof AppError && error.status === 413) {
      throw new AppError(413, "FILE_TOO_LARGE", `${label} must be under ${maxBytes / (1024 * 1024)} MB.`);
    }
    throw error;
  }
  const detectedContentType = detectedImageContentType(uploaded.buffer);
  if (!detectedContentType || !ALLOWED_MIME_TYPES.has(detectedContentType)) {
    throw new AppError(415, "INVALID_FILE_TYPE", "Only JPEG, PNG, and WebP images are accepted.");
  }
  if (uploaded.buffer.byteLength > maxBytes) {
    throw new AppError(413, "FILE_TOO_LARGE", `${label} must be under ${maxBytes / (1024 * 1024)} MB.`);
  }
  if (uploaded.contentType !== "application/octet-stream" && uploaded.contentType !== detectedContentType) {
    throw new AppError(415, "INVALID_FILE_TYPE", "The uploaded file does not match its declared image type.");
  }
  return { buffer: uploaded.buffer, contentType: detectedContentType };
}

/** Validates an image already extracted from multipart form data. */
export async function validateUploadedImageFile(
  file: File,
  label: "Headshot" | "Logo",
  maxBytes = STANDARD_HEADSHOT_MAX_BYTES,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const request = new Request("https://upload.invalid", {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  return readValidatedUploadedImage(request, label, maxBytes);
}

export function imageExtension(contentType: string): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export async function putUploadedImage(
  bucket: R2Bucket,
  key: string,
  image: { buffer: ArrayBuffer; contentType: string },
  label: "headshot" | "logo",
  customMetadata?: Record<string, string>,
): Promise<void> {
  try {
    await bucket.put(key, image.buffer, {
      httpMetadata: { contentType: image.contentType },
      ...(customMetadata ? { customMetadata } : {}),
    });
  } catch {
    throw new AppError(503, "UPLOAD_FAILED", `Failed to upload ${label}`);
  }
}

/**
 * Optional server-side resize optimization using Cloudflare Images binding
 */
export async function resizeHeadshot(
  buffer: ArrayBuffer,
  originalContentType: string,
  envImages?: ImagesBinding,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  if (!envImages) {
    return { buffer, contentType: originalContentType };
  }

  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
    const result = await envImages
      .input(stream)
      .transform({ width: 1024, height: 1024, fit: "cover" })
      .output({ format: "image/jpeg", quality: 95 });
    // We resize it to 1024x1024 JPEG for safety, same as client side.
    return {
      buffer: await (await result.response()).arrayBuffer(),
      contentType: "image/jpeg",
    };
  } catch (err) {
    // Preserve the original validated content type when the optional transform fails.
    console.error("env.IMAGES transform failed:", err);
    return { buffer, contentType: originalContentType };
  }
}
