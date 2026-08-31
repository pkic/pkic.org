/**
 * The viewer's own registration standing for an event: a status badge, the
 * attendance type, and any per-day registered/waitlisted dates. Shared by
 * the portal Home upcoming-events panel and the root events overview so the
 * chip rendering and day-label formatting live in one place rather than
 * being duplicated per surface.
 */
import { Link } from "wouter";
import type { EventViewerState } from "../../../../../shared/schemas/event-management";
import { Badge } from "../../../../components/Badge";

function attendanceLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** Calendar dates are day-precise; render them as such, never through a zone shift. */
function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function ViewerEventState({ viewer }: { viewer: EventViewerState }) {
  const registeredDays = viewer.days.filter((day) => day.state === "registered").map((day) => day.date);
  const waitlistedDays = viewer.days.filter((day) => day.state === "waitlisted").map((day) => day.date);
  return (
    <Link href="/participation" class="small text-muted d-block portal-event-viewer-state">
      <Badge status={viewer.registrationStatus} label={attendanceLabel(viewer.registrationStatus)} />
      <span class="ms-2">{attendanceLabel(viewer.attendanceType)}</span>
      {registeredDays.length > 0 && <span class="ms-2">Days: {registeredDays.map(formatDayLabel).join(", ")}</span>}
      {waitlistedDays.length > 0 && (
        <span class="ms-2">Waitlisted: {waitlistedDays.map(formatDayLabel).join(", ")}</span>
      )}
      {viewer.waitlisted && waitlistedDays.length === 0 && <Badge status="waitlisted" label="Waitlisted" />}
    </Link>
  );
}
