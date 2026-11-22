import { useEffect, useRef, useState } from "preact/hooks";
import {
  scannerAttendeesResponseSchema,
  scannerAttendeeBadgeResponseSchema,
  type ScannerAttendee,
} from "../../../../../../../shared/schemas/event-scanner-lookup";
import { EVENT_REGISTRATION_STATUS_LABELS } from "../../../../../../../shared/schemas/event-registrations";
import { personDisplayName } from "../../../../../../../shared/person-display";
import { SearchPicker } from "../../../../../../components/SearchPicker";
import type { FieldControlProps } from "../../../../../../ui/Field";
import { Alert } from "../../../../../../ui/Alert";
import { requestJson } from "../../../../../../shared/api-client";

/** Why someone without a confirmed registration is not admitted, and where the operator sends them. */
function notRegisteredNotice(attendee: ScannerAttendee, name: string): string | null {
  if (attendee.registrationStatus === "pending_email_confirmation")
    return `${name} has not confirmed their registration. They can confirm it with the link in their email, or ask an organizer.`;
  if (attendee.registrationStatus === "cancelled")
    return `${name}’s registration is cancelled. Send them to an organizer.`;
  return null;
}

/**
 * Identity suggestions stay in memory. Only the selected badge enters the existing scan form. Every registration
 * matches, with its status, so the desk can tell someone who is not registered from someone it cannot find.
 */
export function ScannerAttendeeSearch({
  slug,
  control,
  onBadge,
  disabled,
}: {
  slug: string;
  control: FieldControlProps;
  onBadge: (code: string) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [slug]);
  function clear() {
    pending.current?.abort();
    setSelected(null);
    setLoading(false);
    setError("");
    onBadge("");
  }
  const nameOf = (user: ScannerAttendee) =>
    personDisplayName({ firstName: user.first_name, lastName: user.last_name }, user.email);
  const label = (user: ScannerAttendee) =>
    [
      nameOf(user),
      user.email,
      user.organization_name,
      user.registrationStatus === "registered" ? null : EVENT_REGISTRATION_STATUS_LABELS[user.registrationStatus],
    ]
      .filter(Boolean)
      .join(" · ");
  async function choose(user: ScannerAttendee) {
    clear();
    setSelected(label(user));
    const notice = notRegisteredNotice(user, nameOf(user));
    if (notice) {
      setError(notice);
      return;
    }
    const request = new AbortController();
    pending.current = request;
    setLoading(true);
    try {
      const badge = await requestJson(
        `/api/v1/events/${encodeURIComponent(slug)}/scans/attendees/${encodeURIComponent(user.id)}/badge`,
        scannerAttendeeBadgeResponseSchema,
        { method: "GET", signal: request.signal, cache: "no-store" },
      );
      if (!request.signal.aborted) onBadge(badge.badgeId);
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Badge unavailable. Enter the printed badge code instead.");
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  return (
    // A notice reads under the field, which keeps its full width.
    <div class="pk-stack pk-stack--tight">
      <SearchPicker
        picked={selected}
        onPick={(user) => void choose(user)}
        onClear={clear}
        onQueryChange={(value) => {
          pending.current?.abort();
          setLoading(false);
          setError("");
          onBadge(value);
        }}
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/scans/attendees`}
        responseSchema={scannerAttendeesResponseSchema}
        rows={(data) => data.users}
        rowKey={(user) => user.id}
        rowText={label}
        renderRow={label}
        label="Find an attendee or enter a badge code"
        resultsLabel="Matching attendees"
        noun={["attendee", "attendees"]}
        sort="email"
        disabled={disabled}
        inputProps={{ ...control, name: "badgeId" }}
        placeholder="Badge code, name, email, or organization"
        emptyMessage="No registration matches. You can still enter a badge code."
        errorMessage="Search is unavailable. Enter a badge code instead."
      />
      {loading && <p role="status">Loading the selected attendee’s badge…</p>}
      {error && <Alert tone="warn">{error}</Alert>}
    </div>
  );
}
