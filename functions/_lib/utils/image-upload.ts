import { AppError } from "../errors";
import { readBoundedBody, readBoundedMultipartFormData } from "../http-body";
import { type ImagesBinding } from "../types";
import { IMAGE_UPLOAD_ALLOWED_MIME_TYPES, STANDARD_HEADSHOT_MAX_BYTES } from "../../../assets/shared/schemas/images";
import { imageExtensionForContentType, validateRasterImage } from "./image-format";
import { sanitizeSvgLogo, SVG_LOGO_CONTENT_TYPE, type SanitizedSvgLogo } from "./svg-logo";

export const ALLOWED_MIME_TYPES = new Set<string>(IMAGE_UPLOAD_ALLOWED_MIME_TYPES);

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
  return readBoundedMultipartFormData(request, maxFileBytes);
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
  const validation = validateRasterImage(uploaded.buffer);
  if (!validation.ok) {
    if (validation.reason === "dimensions") {
      throw new AppError(413, "IMAGE_DIMENSIONS_TOO_LARGE", `${label} dimensions exceed the supported limit.`);
    }
    throw new AppError(415, "INVALID_FILE_TYPE", "Only JPEG, PNG, and WebP images are accepted.");
  }
  const detectedContentType = validation.image.contentType;
  if (!ALLOWED_MIME_TYPES.has(detectedContentType)) {
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

export function imageExtension(contentType: string): "jpg" | "png" | "webp" | "svg" {
  if (contentType === SVG_LOGO_CONTENT_TYPE) return "svg";
  return imageExtensionForContentType(contentType);
}

export const ORGANIZATION_LOGO_MAX_BYTES = 1024 * 1024;

/**
 * Organization logos are SVG-only. Reads the upload, rejects rasters with a
 * policy-stating error, and returns the sanitized, normalized SVG (see
 * svg-logo.ts) — never the caller's original bytes.
 */
export async function readValidatedUploadedSvgLogo(
  request: Request,
  maxBytes = ORGANIZATION_LOGO_MAX_BYTES,
): Promise<SanitizedSvgLogo> {
  let uploaded: { buffer: ArrayBuffer; contentType: string };
  try {
    uploaded = await readUploadedImage(request, maxBytes);
  } catch (error) {
    if (error instanceof AppError && error.status === 413) {
      throw new AppError(413, "FILE_TOO_LARGE", `Logo must be under ${maxBytes / (1024 * 1024)} MB.`);
    }
    throw error;
  }
  if (validateRasterImage(uploaded.buffer).ok) {
    throw new AppError(415, "INVALID_FILE_TYPE", "Only SVG logos are accepted.");
  }
  const declared = uploaded.contentType.split(";")[0].trim().toLowerCase();
  if (declared !== SVG_LOGO_CONTENT_TYPE && declared !== "application/octet-stream") {
    throw new AppError(415, "INVALID_FILE_TYPE", "Only SVG logos are accepted.");
  }
  return sanitizeSvgLogo(uploaded.buffer);
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
  envImages?: ImagesBinding,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const originalValidation = validateRasterImage(buffer);
  if (!originalValidation.ok) {
    if (originalValidation.reason === "dimensions") {
      throw new AppError(413, "IMAGE_DIMENSIONS_TOO_LARGE", "Headshot dimensions exceed the supported limit.");
    }
    throw new AppError(415, "INVALID_FILE_TYPE", "Only JPEG, PNG, and WebP images are accepted.");
  }
  const original = { buffer, contentType: originalValidation.image.contentType };
  if (!envImages) {
    return original;
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
    const transformedBuffer = await (await result.response()).arrayBuffer();
    const transformedValidation = validateRasterImage(transformedBuffer);
    if (!transformedValidation.ok) return original;
    // We resize it to 1024x1024 JPEG for safety, same as client side.
    return { buffer: transformedBuffer, contentType: transformedValidation.image.contentType };
  } catch (err) {
    // Preserve the original validated content type when the optional transform fails.
    console.error("env.IMAGES transform failed:", err);
    return original;
  }
}
