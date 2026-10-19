/** A page release is distinct from the independently fingerprinted worker module. */
export const PORTAL_WORKER_RELEASE_PARAMETER = "portalRelease";

export function portalWorkerCacheIdentity(href: string): string {
  const url = new URL(href);
  const release = url.searchParams.get(PORTAL_WORKER_RELEASE_PARAMETER);
  if (release !== null && !/^[a-f0-9]{64}$/.test(release)) throw new Error("Invalid portal offline release");
  return `${url.origin}${url.pathname}${release === null ? "" : `?${PORTAL_WORKER_RELEASE_PARAMETER}=${release}`}`;
}

let pageAssets: { entry: string; styles: string[] } | null = null;

/** Capture the initial page before App can introduce route-dependent lazy CSS. */
export function capturePortalWorkerPageAssets(entry: string): void {
  if (pageAssets) return;
  pageAssets = {
    entry,
    styles: [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')].map((link) => link.href),
  };
}

export async function portalWorkerPageRelease(): Promise<string> {
  if (!pageAssets) throw new Error("Portal offline release is unavailable");
  const builtUrl = (value: string, extension: string) => {
    const url = new URL(value, location.origin);
    if (
      url.origin !== location.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["/_assets/", "/js/built/"].some((prefix) => url.pathname.startsWith(prefix)) ||
      !url.pathname.endsWith(extension)
    )
      throw new Error("Portal offline release is unavailable");
    return `${url.origin}${url.pathname}`;
  };
  const source = builtUrl(pageAssets.entry, ".js");
  const styles = pageAssets.styles
    .map((value) => new URL(value, location.origin))
    .filter(
      (url) =>
        url.origin === location.origin && ["/_assets/", "/js/built/"].some((prefix) => url.pathname.startsWith(prefix)),
    )
    .map((url) => builtUrl(url.href, ".css"));
  const identity = [...new Set([source, ...styles])].sort().join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
