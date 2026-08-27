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

export function externalLink(url: string) {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {url}
    </a>
  );
}
