import type { ComponentProps } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ScannerLocationSelect } from "./ScannerLocationSelect";
import { ScannerTargetPicker } from "./ScannerTargetPicker";
import { useScannerSuggestions } from "./useScannerSuggestions";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { Tabs } from "../../../../../../components/Tabs";
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
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("now");
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
  useEffect(() => {
    if (suggestions.timeZone) location.onTimeZone?.(suggestions.timeZone);
  }, [suggestions.timeZone]);
  if (sponsorOnly) return null;
  function close() {
    setOpen(false);
  }
  return (
    <>
      <div class="pk-cluster">
        <Button type="button" variant="secondary" disabled={locked || !ready} onClick={() => setOpen(true)}>
          Choose session or room
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={locked || !ready}
          onClick={() => {
            suggestions.manual();
            location.onTarget(null);
          }}
        >
          Event entrance
        </Button>
      </div>
      {locked && <p class="pk-muted">Finish scanning and sync pending scans before changing the session.</p>}
      <Dialog
        open={open}
        title="Choose check-in session"
        confirmLabel="Done"
        cancelLabel="Close"
        onConfirm={close}
        onCancel={close}
      >
        {open && (
          <div class="pk-stack">
            <Tabs
              label="Find sessions"
              active={view}
              onChange={setView}
              items={[
                { key: "now", label: "Now" },
                { key: "next", label: "Next" },
                { key: "shifts", label: "My shifts" },
                { key: "browse", label: "Browse days and rooms" },
              ]}
            />
            {view === "shifts" ? (
              <section aria-label="Your assigned check-in sessions">
                <p>Assignments suggest where to scan. Your scan permissions still apply.</p>
                {suggestions.loading && <p role="status">Loading assigned sessions…</p>}
                {suggestions.error && <p role="status">{suggestions.error}</p>}
                {!suggestions.loading && !suggestions.error && suggestions.suggestions.length === 0 && (
                  <p>No current or upcoming assigned check-in sessions. Use Now, Next, or Browse.</p>
                )}
                {suggestions.truncated && <p>More assignments are available. Choose the session and room manually.</p>}
                {suggestions.suggestions.map((suggestion) => (
                  <div
                    key={`${suggestion.occurrence.id}:${suggestion.suggestedRoomId ?? ""}`}
                    class="pk-stack pk-stack--snug"
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={locked || !ready}
                      onClick={() => {
                        suggestions.choose(suggestion);
                        close();
                      }}
                    >
                      {suggestion.occurrence.title}
                      {suggestion.suggestedRoomId &&
                        ` · ${suggestion.occurrence.rooms?.find((room) => room.id === suggestion.suggestedRoomId)?.name ?? "Room"}`}
                    </Button>
                    <small>
                      {suggestion.status === "current" ? "Current duty" : "Upcoming duty"} ·{" "}
                      {suggestion.roles.join(" / ")} ·{" "}
                      {suggestions.timeZone &&
                        formatTimeRangeInZone(suggestion.startAt, suggestion.endAt, suggestions.timeZone)}{" "}
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
              </section>
            ) : (
              <ScannerTargetPicker
                key={view}
                {...location}
                disabled={locked || !ready}
                timeWindow={view === "now" || view === "next" ? view : undefined}
                onTarget={(target) => {
                  suggestions.manual();
                  location.onTarget(target);
                  if ((target?.rooms?.length ?? 0) <= 1) close();
                }}
                onRoom={(id) => {
                  suggestions.manual();
                  location.onRoom(id);
                  close();
                }}
              />
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
