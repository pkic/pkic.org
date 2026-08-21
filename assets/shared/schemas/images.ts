/** Canonical browser-safe raster image types accepted by every upload surface. */
export const IMAGE_UPLOAD_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Admin and member profile uploads are optionally resized by Cloudflare Images. */
export const STANDARD_HEADSHOT_MAX_BYTES = 5 * 1024 * 1024;

/** Registration uploads are already cropped and compressed in the browser. */
export const REGISTRATION_HEADSHOT_MAX_BYTES = 2 * 1024 * 1024;

/** Speaker flows accept a larger source image because those clients do not all crop locally. */
export const SPEAKER_HEADSHOT_MAX_BYTES = 20 * 1024 * 1024;
