/**
 * One recognizer for YouTube video addresses, shared by Markdown media, recordings, meeting broadcasts and
 * event live streams. Live broadcasts use the same video identifiers as uploaded videos.
 */

/** A YouTube video (or live broadcast) identifier: exactly eleven URL-safe base64 characters. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "youtube-nocookie.com"]);

/** The video segment of a recognized YouTube address, or null for anything else. Accepts any segment length. */
export function youtubeVideoUrlSegment(url: URL): string | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  const id =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : YOUTUBE_HOSTS.has(host)
        ? url.pathname === "/watch"
          ? url.searchParams.get("v")
          : (/^\/(?:live|embed|shorts)\/([\w-]+)\/?$/u.exec(url.pathname)?.[1] ?? null)
        : null;
  return id && /^[\w-]+$/u.test(id) ? id : null;
}

/** The video ID in a YouTube address or a bare ID, or null when the input names no YouTube video. */
export function youtubeVideoId(input: string): string | null {
  const value = input.trim();
  if (YOUTUBE_VIDEO_ID_PATTERN.test(value)) return value;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/iu.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const id = youtubeVideoUrlSegment(url);
  return id && YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
}

/** The privacy-enhanced player address for one video; the portal's CSP admits only this frame origin for it. */
export function youtubePrivacyEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1`;
}

/** The video's own page on YouTube, for a viewer whose player will not start. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
