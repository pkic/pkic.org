export function normalizeProfileLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "url" in entry && typeof entry.url === "string") return entry.url;
      return "";
    })
    .map((url) => url.trim())
    .filter(Boolean);
}
