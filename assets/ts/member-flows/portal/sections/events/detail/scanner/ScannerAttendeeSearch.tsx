import { useEffect, useRef, useState } from "preact/hooks";
import {
  scannerAttendeesResponseSchema,
  scannerAttendeeBadgeResponseSchema,
} from "../../../../../../../shared/schemas/event-scanner-lookup";
import type { UserCatalogItem } from "../../../../../../../shared/schemas/user-catalog";
import { personDisplayName } from "../../../../../../../shared/person-display";
import { SearchPicker } from "../../../../../../components/SearchPicker";
import type { FieldControlProps } from "../../../../../../ui/Field";
import { Alert } from "../../../../../../ui/Alert";
import { requestJson } from "../../../../../../shared/api-client";

/** Identity suggestions stay in memory. Only the selected badge enters the existing scan form. */
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
  const label = (user: UserCatalogItem) =>
    [
      personDisplayName({ firstName: user.first_name, lastName: user.last_name }, user.email),
      user.email,
      user.organization_name,
    ]
      .filter(Boolean)
      .join(" · ");
  async function choose(user: UserCatalogItem) {
    clear();
    const request = new AbortController();
    pending.current = request;
    setSelected(label(user));
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
    <>
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
        emptyMessage="No matching attendees. You can still enter a badge code."
        errorMessage="Search is unavailable. Enter a badge code instead."
      />
      {loading && <p role="status">Loading the selected attendee’s badge…</p>}
      {error && <Alert tone="warn">{error}</Alert>}
    </>
  );
}
