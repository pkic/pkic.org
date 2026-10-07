import type { ComponentProps } from "preact";
import { ScannerLocationSelect } from "./ScannerLocationSelect";
import { useScannerSuggestions } from "./useScannerSuggestions";
import { Button } from "../../../../../../ui/Button";
import { formatTimeRangeInZone } from "../../../../../../../shared/format-date";

export function ScannerSetup({
  operatorUserId,
  sponsorOnly,
  explicitTarget,
  ready,
  locked,
  ...location
}: ComponentProps<typeof ScannerLocationSelect> & {
  operatorUserId: string;
  sponsorOnly: boolean;
  explicitTarget: boolean;
  ready: boolean;
  locked: boolean;
}) {
  const suggestions = useScannerSuggestions({
    slug: location.slug,
    operatorUserId,
    enabled: !sponsorOnly,
    explicitTarget,
    ready,
    locked,
    onChoose: (suggestion) => {
      location.onTarget(suggestion.occurrence);
      location.onRoom(suggestion.suggestedRoomId);
    },
  });
  return (
    <>
      {!sponsorOnly &&
        (suggestions.loading || suggestions.error || suggestions.truncated || suggestions.suggestions.length > 0) && (
          <section aria-label="Your assigned check-in sessions">
            <h3>Your assigned check-in sessions</h3>
            {suggestions.loading && <p role="status">Loading assigned sessions…</p>}
            {suggestions.error && <p role="status">{suggestions.error}</p>}
            {suggestions.truncated && <p>More assignments are available. Choose the session and room manually.</p>}
            {suggestions.suggestions.map((suggestion) => (
              <div key={`${suggestion.occurrence.id}:${suggestion.suggestedRoomId ?? ""}`} class="pk-stack">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={locked || !ready}
                  onClick={() => suggestions.choose(suggestion)}
                >
                  {suggestion.occurrence.title}
                  {suggestion.suggestedRoomId &&
                    ` · ${suggestion.occurrence.rooms?.find((room) => room.id === suggestion.suggestedRoomId)?.name ?? "Room"}`}
                </Button>
                <small>
                  {suggestion.status === "current" ? "Current duty" : "Upcoming duty"} · {suggestion.roles.join(" / ")}{" "}
                  · {formatTimeRangeInZone(suggestion.startAt, suggestion.endAt, suggestions.timeZone!)}{" "}
                  {suggestions.timeZone}
                </small>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              disabled={locked || suggestions.loading}
              onClick={suggestions.refresh}
            >
              Refresh assignments
            </Button>
            {locked && <p>Finish scanning and sync pending scans before choosing an assigned session.</p>}
          </section>
        )}
      {!sponsorOnly && (
        <ScannerLocationSelect
          {...location}
          onTarget={(target) => {
            suggestions.manual();
            location.onTarget(target);
          }}
          onRoom={(roomId) => {
            suggestions.manual();
            location.onRoom(roomId);
          }}
        />
      )}
    </>
  );
}
