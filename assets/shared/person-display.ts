/**
 * How a person reads in one line wherever they are listed or picked: the
 * name a record resolves to, and the identity they act as.
 */

/** A first/last/email triple as one display name: the name on file, else the address. */
export function personDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
): string {
  return [firstName, lastName].filter(Boolean).join(" ") || email || "—";
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
