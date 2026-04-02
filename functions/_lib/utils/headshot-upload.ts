import { AppError } from "../errors";
import { type ImagesBinding } from "../types";

export const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Robustly reads an uploaded image from a Request, handling both:
 * 1. direct binary POST/PUT (e.g., from the frontend client's fetch API)
 * 2. multipart/form-data (e.g., from Vite/Playwright tests or traditional forms)
 *
 * It eagerly consumes the request body as an ArrayBuffer to prevent stream timeout
 * drops in Wrangler dev when async DB operations follow.
 */
export async function readUploadedImage(
  request: Request
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  // EAGERLY consume the body as an ArrayBuffer.
  // This must be done BEFORE any async database queries (like reading from D1)
  // to prevent Wrangler from dropping the TCP stream.
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await request.arrayBuffer();
  } catch (err) {
    throw new AppError(400, "BODY_READ_ERROR", "Failed to receive upload body");
  }

  const reqContentType = request.headers.get("content-type") || "";

  if (reqContentType.includes("multipart/form-data")) {
    // Parse the array buffer back into formdata
    const boundaryMatch = reqContentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = boundaryMatch ? boundaryMatch[1] || boundaryMatch[2] : "";
    if (!boundary) throw new AppError(400, "INVALID_MULTIPART", "Could not parse multipart boundary");

    const formData = await new Response(arrayBuffer, { headers: { "Content-Type": reqContentType } }).formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      throw new AppError(400, "MISSING_FILE", "A 'file' field is required.");
    }
    const fileBuffer = await file.arrayBuffer();
    return { buffer: fileBuffer, contentType: file.type };
  }

  if (reqContentType === "application/octet-stream" || reqContentType.startsWith("image/")) {
    return { buffer: arrayBuffer, contentType: reqContentType };
  }

  throw new AppError(400, "INVALID_CONTENT_TYPE", "Request must be multipart/form-data or an image type");
}

/**
 * Optional server-side resize optimization using Cloudflare Images binding
 */
export async function resizeHeadshot(
  buffer: ArrayBuffer,
  envImages?: ImagesBinding
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  if (!envImages) {
    // Fallback: If not configured, just store raw
    return { buffer, contentType: "image/jpeg" };
  }
  
  try {
    // We resize it to 1024x1024 JPEG for safety, same as client side.
    return {
      buffer: await envImages.input(buffer).transform({ width: 1024, height: 1024, fit: "cover" }).output({ format: "image/jpeg", quality: 85 }),
      contentType: "image/jpeg"
    };
  } catch (err) {
    // Log error, but still return original raw file so the user doesn't get blocked
    console.error("env.IMAGES transform failed:", err);
    return { buffer, contentType: "image/jpeg" };
  }
}
