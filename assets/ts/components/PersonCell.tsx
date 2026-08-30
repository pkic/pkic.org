/**
 * The canonical way a person appears in a list: face first, then name, with
 * the email as the quiet second line — never a monospace identifier leading
 * the row. Falls back to initials when no headshot exists and to the email
 * as the display name when no name is on file.
 */

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
  return (
    <div class="d-flex align-items-center gap-2">
      <span class="portal-user-avatar portal-user-avatar--table" aria-hidden="true">
        {headshotUrl ? <img src={headshotUrl} alt="" /> : personInitials(name)}
      </span>
      <span class="d-flex flex-column">
        <span class="fw-semibold">{name}</span>
        {secondLine && <span class="text-muted small">{secondLine}</span>}
      </span>
    </div>
  );
}
