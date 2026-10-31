/**
 * How a person reads in one line wherever they are listed or picked: the
 * name a record resolves to, and the identity they act as.
 *
 * One rule names a person everywhere they are shown as themselves: the
 * preferred name stands in for the first name, and the last name follows
 * ("Bob Smith" for Robert Smith who prefers Bob). Badges print the same two
 * parts. Staff who match an account to proof of who someone is read the legal
 * name instead: the first and last name on file, never the preferred name.
 * The Worker's `personNameSql` applies the same rule in D1 queries.
 */

/** The name parts on a user record; the preferred name is the first name the person goes by. */
export interface PersonNameParts {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
}

function joinName(first: string | null | undefined, last: string | null | undefined): string {
  return [first?.trim(), last?.trim()].filter(Boolean).join(" ");
}

/** The name a person goes by: preferred name, else first name, then last name; else `fallback`. */
export function personDisplayName(parts: PersonNameParts, fallback: string | null | undefined): string {
  return joinName(parts.preferredName?.trim() || parts.firstName, parts.lastName) || fallback || "—";
}

/** The legal name, for staff matching an account to proof: first and last name on file; else `fallback`. */
export function personLegalName(parts: PersonNameParts, fallback: string | null | undefined): string {
  return joinName(parts.firstName, parts.lastName) || fallback || "—";
}

/**
 * The identity a person acts as, title first: "CTO at Example Org". Either
 * part alone stands by itself; empty for someone who appears as themselves.
 * A broadcast lower third sets these on lines of its own instead.
 */
export function personRoleAt(identity: { title?: string | null; organization?: string | null }): string {
  const { title, organization } = identity;
  if (title && organization) return `${title} at ${organization}`;
  return title || organization || "";
}
