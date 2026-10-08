import "../../../../../../ui/ButtonToggle.css";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { Button } from "../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../ui/MediaIcons";
import { AgendaSourcesControl } from "./AgendaSourcesControl";
import { Alert } from "../../../../../../ui/Alert";

export function AgendaEditingControl({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  const label = locked ? "Enable agenda editing" : "Stop editing";
  return (
    <Button variant="secondary" icon aria-label={label} title={label} aria-pressed={!locked} onClick={onToggle}>
      <StrokeIcon>
        <rect x="3" y="7" width="10" height="7" rx="1" />
        <path d={locked ? "M5 7V5a3 3 0 0 1 6 0v2" : "M7 7V4a3 3 0 0 1 6 0v1"} />
      </StrokeIcon>
    </Button>
  );
}

export function AgendaEditingWarning({ snapshot, enabled }: { snapshot: AgendaSnapshot; enabled: boolean }) {
  if (!enabled) return null;
  const now = new Date();
  const lastAgendaDate = [snapshot.eventStartsAt, ...snapshot.occurrences.flatMap((row) => [row.startAt, row.endAt])]
    .filter((value): value is string => Boolean(value))
    .map((value) => instantToDateTimeLocal(value, snapshot.timeZone).slice(0, 10))
    .sort()
    .at(-1);
  const historical = snapshot.eventEndsAt
    ? Date.parse(snapshot.eventEndsAt) < now.getTime()
    : snapshot.occurrences.length > 0 &&
      lastAgendaDate &&
      lastAgendaDate < instantToDateTimeLocal(now.toISOString(), snapshot.timeZone).slice(0, 10);
  return historical ? (
    <Alert tone="warn">
      {snapshot.eventEndsAt ? "This event has ended." : "This agenda contains past dates."} Editing may change its
      historical agenda.
    </Alert>
  ) : null;
}

export function AgendaEditorControls({
  canEdit,
  locked,
  onToggle,
  eventSlug,
  sourcesOpen,
  onSourcesToggle,
}: {
  canEdit: boolean;
  locked: boolean;
  onToggle: () => void;
  eventSlug: string;
  sourcesOpen: boolean;
  onSourcesToggle: () => void;
}) {
  return (
    <>
      {canEdit && <AgendaEditingControl locked={locked} onToggle={onToggle} />}
      <AgendaSourcesControl eventSlug={eventSlug} open={sourcesOpen} onToggle={onSourcesToggle} />
    </>
  );
}
