/** Small display/coercion helpers shared across the Applications detail cards. */

export function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

export function asBool(value: unknown): boolean {
  return value === true;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * An address a reviewer opens or checks — an organization's website, not a
 * profile on a site the system can name. The scheme is dropped from what is
 * shown, matching every other labelled address row in the portal and on the
 * public member page; the full URL is still what the link goes to.
 *
 * A subject's *profile* links do not come through here. They are a set of
 * destinations rather than an address to read, and they get the shared
 * `LinkList` badge instead — printing them as raw text is issue #13.
 */
/** An answer typed without a scheme is still an address; this is what it meant. */
export function toHttpUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function externalLink(url: string) {
  const href = toHttpUrl(url);
  return (
    <a class="pk-break" href={href} target="_blank" rel="noreferrer">
      {url.replace(/^https?:\/\//, "")}
    </a>
  );
}
