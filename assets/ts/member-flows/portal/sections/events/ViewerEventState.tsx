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
// Dates render through the one shared module, which is day-precise, follows
// the viewer's own locale, and answers an em dash rather than "Invalid Date"
// for a value it cannot read. A formatter written here would be another copy
// of that policy, and copies drift (issue #19).
import { formatDayAndMonth } from "../../../../shared/ui";

function attendanceLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function ViewerEventState({ viewer, href }: { viewer: EventViewerState; href?: string }) {
  const registeredDays = viewer.days.filter((day) => day.state === "registered").map((day) => day.date);
  const waitlistedDays = viewer.days.filter((day) => day.state === "waitlisted").map((day) => day.date);
  const content = (
    <>
      <Badge status={viewer.registrationStatus} label={attendanceLabel(viewer.registrationStatus)} />
      <span>{attendanceLabel(viewer.attendanceType)}</span>
      {registeredDays.length > 0 && <span>Days: {registeredDays.map(formatDayAndMonth).join(", ")}</span>}
      {waitlistedDays.length > 0 && <span>Waitlisted: {waitlistedDays.map(formatDayAndMonth).join(", ")}</span>}
      {viewer.waitlisted && waitlistedDays.length === 0 && <Badge status="waitlisted" label="Waitlisted" />}
    </>
  );
  return href ? (
    <Link href={href} class="pk-cluster pk-small">
      {content}
    </Link>
  ) : (
    <span class="pk-cluster pk-small">{content}</span>
  );
}
