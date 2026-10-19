/**
 * The name a new layout gets in browser-source links, from its display name:
 * lowercase words joined by hyphens, numbered when the event already has it.
 * It never changes afterwards, so renaming a layout keeps every scene that uses it.
 */
export function layoutSlugFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34)
      .replace(/-+$/g, "") || "layout";
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
