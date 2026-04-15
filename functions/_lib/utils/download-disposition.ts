const KNOWN_IMAGE_EXTENSION_RE = /\.(?:jpe?g|png|webp|gif|avif|svg|tiff?|ico|bmp|heic|heif)$/i;

export function contentTypeToFileExtension(contentType: string): string {
  if (!contentType.startsWith("image/")) {
    return "jpg";
  }

  const subtype = contentType.slice("image/".length);
  switch (subtype) {
    case "jpeg":
    case "pjpeg":
    case "jpg":
      return "jpg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "gif":
      return "gif";
    case "avif":
      return "avif";
    case "svg+xml":
      return "svg";
    case "tiff":
      return "tif";
    case "x-icon":
    case "vnd.microsoft.icon":
      return "ico";
    default:
      return "img";
  }
}

export function buildDownloadDisposition(
  rawName: string,
  contentType: string | null,
  fallbackBaseName: string,
): string {
  const baseName = rawName.split(/[/\\]/).pop() || "";
  const safeName =
    baseName
      .replace(/[^a-zA-Z0-9_.\- ]/g, "") // Strictly whitelist safe characters
      .replace(/^\.+|\.+$/g, "") // Remove leading/trailing dots to prevent hidden files/extension trickery
      .replace(/\.+/g, ".") // Collapse multiple dots
      .trim()
      .replace(KNOWN_IMAGE_EXTENSION_RE, "") || fallbackBaseName;

  const normalizedType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "image/jpeg";
  const ext = contentTypeToFileExtension(normalizedType);
  return `attachment; filename="${safeName}.${ext}"`;
}

export function applyDownloadDisposition(response: Response, rawName: string, fallbackBaseName: string): Response {
  response.headers.set(
    "Content-Disposition",
    buildDownloadDisposition(rawName, response.headers.get("Content-Type"), fallbackBaseName),
  );
  return response;
}
