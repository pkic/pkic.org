/** Builds a compact, deterministic fallback monogram for a member name. */
export function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 3)
    .map((word) => word.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
