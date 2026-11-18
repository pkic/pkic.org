/** Preview identities stay under their own domain, separate from production. */
export const PREVIEW_HOSTNAME = "preview.pkic.org";
const WORKERS_PREVIEW_RP_ID = "pkic.workers.dev";
const WORKERS_PREVIEW_SUFFIX = `-pkic-org.${WORKERS_PREVIEW_RP_ID}`;

/** Only hosts issued for this Worker's Previews, never its production address. */
export function previewOriginIdentity(value: string): { origin: string; rpId: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "") return null;
  for (const [suffix, rpId] of [
    [`.${PREVIEW_HOSTNAME}`, PREVIEW_HOSTNAME],
    [WORKERS_PREVIEW_SUFFIX, WORKERS_PREVIEW_RP_ID],
  ]) {
    const label = url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : "";
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return { origin: url.origin, rpId };
  }
  return null;
}
