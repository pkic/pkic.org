/** Recognized YouTube destinations; a caller decides when the viewer may receive one. */
export function youtubeVideoEmbed(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : host === "youtube.com" || host === "youtube-nocookie.com"
          ? url.pathname === "/watch"
            ? url.searchParams.get("v")
            : /^\/(?:live|embed|shorts)\/([\w-]+)$/.exec(url.pathname)?.[1]
          : null;
    return id && /^[\w-]+$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  } catch {
    return null;
  }
}

/** Media policy shared by the visual editor and the public Markdown renderer. */
export function markdownVideoEmbed(value: string): string | null {
  const link = /^\[[^\]]*\]\((\S+)\)$/.exec(value.trim());
  try {
    const url = new URL(link?.[1] ?? value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const youtube = youtubeVideoEmbed(url.href);
    if (youtube) return youtube;
    if (host === "vimeo.com" && /^\/\d+$/.test(url.pathname)) return `https://player.vimeo.com/video${url.pathname}`;
  } catch {
    /* Prose is not a media URL. */
  }
  return null;
}

export function markdownSafeUrl(value: string, image = false): boolean {
  if (
    !value ||
    [...value].some((character) => character.charCodeAt(0) <= 32) ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return false;
  if (/^[a-z0-9+.-]+:/i.test(value)) return (image ? /^https?:/i : /^(https?:|mailto:|tel:)/i).test(value);
  return true;
}
