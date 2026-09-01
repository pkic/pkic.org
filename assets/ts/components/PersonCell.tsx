/**
 * The canonical way a person appears in a list: face first, then name, with
 * the email as the quiet second line — never a monospace identifier leading
 * the row. Falls back to initials when no headshot exists and to the email
 * as the display name when no name is on file.
 *
 * The arrangement is the design system's PersonCell. What stays here is the
 * product's naming policy, which the system cannot own: how a
 * first/last/email triple resolves into one display name, and what the second
 * line says when it is not the email. Callers keep passing the record's
 * fields; they never have to decide which of them is the name.
 */

import { PersonCell as SystemPersonCell } from "../ui/PersonCell";

export function personInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function personDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
): string {
  return [firstName, lastName].filter(Boolean).join(" ") || email || "—";
}

export function PersonCell({
  firstName,
  lastName,
  email,
  headshotUrl,
  secondary,
}: {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  email: string | null | undefined;
  headshotUrl?: string | null;
  /** Overrides the default secondary line (the email). Pass null to omit. */
  secondary?: string | null;
}) {
  const name = personDisplayName(firstName, lastName, email);
  const secondLine = secondary === undefined ? (name === email ? null : email) : secondary;

  // `sm` is the 2rem avatar, which is what the portal's list rows already
  // used. The default `md` is a third larger and would change every row's
  // height.
  return (
    <SystemPersonCell name={name} email={secondLine ?? undefined} avatarSrc={headshotUrl ?? undefined} size="sm" />
  );
}
