/**
 * The registration list's figures: how many stand in each status, and how
 * many hold each kind of attendance — with the waitlisted share stated under
 * the accepted one, since a manager reading "4 in-person" needs to know that
 * three of them are still waiting for a seat.
 */
import { CollectionTotals, type CollectionTotal } from "../CollectionTotals";
import type { StatCardTone } from "../../ui/StatCard";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../../shared/attendance";
import {
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationStatusLabel,
  type EventAttendanceRegistrationsStats,
} from "../../../shared/schemas/event-registrations";

/** The tone each status's figure wears: the one its badge wears in the rows. */
const STATUS_TONES: Record<string, StatCardTone> = {
  registered: "ok",
  pending_confirmation: "info",
  cancelled: "neutral",
};

export function RegistrationTotals({
  stats,
}: {
  stats: EventAttendanceRegistrationsStats & { bouncedCount?: number };
}) {
  const items: CollectionTotal[] = [];
  for (const status of EVENT_REGISTRATION_STATUSES) {
    const count = stats.byStatus[status] ?? 0;
    if (count > 0 || status === "registered") {
      items.push({
        label: eventRegistrationStatusLabel(status).toLowerCase(),
        value: count,
        tone: STATUS_TONES[status],
      });
    }
  }
  const attendanceTypes = new Set([
    ...Object.keys(ATTENDANCE_TYPE_LABELS).filter((type) => type !== "not_attending"),
    ...Object.keys(stats.attendanceStatusByType),
  ]);
  for (const type of attendanceTypes) {
    const accepted = stats.attendanceStatusByType[type]?.accepted ?? 0;
    const waitlisted = stats.attendanceStatusByType[type]?.waitlisted ?? 0;
    if (accepted + waitlisted === 0) continue;
    items.push({
      label: attendanceTypeLabel(type).toLowerCase(),
      value: accepted,
      note: waitlisted > 0 ? `+${String(waitlisted)} waitlisted` : undefined,
      // A live waitlist is the one attendance figure that asks for action.
      tone: waitlisted > 0 ? "warn" : undefined,
    });
  }
  if ((stats.bouncedCount ?? 0) > 0) items.push({ label: "bounced", value: stats.bouncedCount ?? 0, tone: "danger" });
  return <CollectionTotals label="Registration totals" items={items} />;
}
