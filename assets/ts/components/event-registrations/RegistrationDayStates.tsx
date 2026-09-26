/**
 * What a registration holds, day by day, on a list row and in a record's
 * header.
 *
 * A registration's `attendance_type` is a derivation: in-person if any day
 * is, else virtual, else on-demand. On a list it read a three-day
 * registration with one confirmed day and two waitlisted ones as plainly
 * "in-person", and said nothing about the waitlist at all — which is the
 * one thing a manager opens the list to find out. Each day says its own
 * state in words and a tone that agrees with them; the tone never carries
 * the meaning on its own.
 */
import type { RegistrationDayState } from "../../../shared/schemas/event-registrations";
import { formatDayAndMonth } from "../../../shared/format-date";
import { attendanceTypeLabel } from "../../shared/attendance";
import { Badge, type BadgeTone } from "../../ui/Badge";

/** The words and tone for one day's state. */
export function registrationDayStatus(day: RegistrationDayState): { label: string; tone: BadgeTone } {
  if (day.waitlistStatus === "waiting") return { label: "Waitlisted", tone: "warn" };
  if (day.waitlistStatus === "offered") return { label: "Seat offered", tone: "info" };
  if (day.attendanceType === "in_person") return { label: attendanceTypeLabel(day.attendanceType), tone: "ok" };
  return { label: attendanceTypeLabel(day.attendanceType), tone: "neutral" };
}

/** The days still waiting for, or offered, an in-person seat. */
export function pendingRegistrationDays(days: readonly RegistrationDayState[]): RegistrationDayState[] {
  return days.filter((day) => day.waitlistStatus !== null);
}

/**
 * One sentence for a header: "3 days · 2 in-person · 1 waitlisted". An event
 * without days falls back to the whole-registration attendance type.
 */
export function describeRegistrationDays(days: readonly RegistrationDayState[], attendanceType: string | null): string {
  if (days.length === 0) return attendanceTypeLabel(attendanceType);
  const counts = new Map<string, number>();
  for (const day of days) {
    const { label } = registrationDayStatus(day);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([label, count]) => `${String(count)} ${label.toLowerCase()}`);
  return `${String(days.length)} ${days.length === 1 ? "day" : "days"} · ${parts.join(" · ")}`;
}

/**
 * One line per registration (#119). Most attendees hold every day the same
 * way, so the row says "Virtual" once; only the exceptions spell out the
 * distinct states — "In-person, Virtual" — still on one line, with the days
 * behind each state in the badge's tooltip. A three-day event used to stack
 * three badges per row, and a five-day one would have been five.
 */
export function RegistrationDayStates({
  days,
  attendanceType,
}: {
  days: readonly RegistrationDayState[];
  attendanceType: string | null;
}) {
  if (days.length === 0) {
    return attendanceType ? <>{attendanceTypeLabel(attendanceType)}</> : <span class="pk-muted">—</span>;
  }
  // The distinct states in the order the days hold them, each with its days.
  const states = new Map<string, { tone: BadgeTone; days: string[] }>();
  for (const day of days) {
    const status = registrationDayStatus(day);
    const entry = states.get(status.label) ?? { tone: status.tone, days: [] };
    entry.days.push(formatDayAndMonth(day.dayDate));
    states.set(status.label, entry);
  }
  const single = states.size === 1;
  return (
    // A list, so a screen reader announces "2 items" before reading the
    // states rather than running the badges together as one string.
    <ul class="pk-cluster pk-cluster--nowrap pk-plain-list" aria-label="Attendance by day">
      {[...states.entries()].map(([label, entry]) => (
        <li key={label} title={single ? undefined : entry.days.join(", ")}>
          <Badge tone={entry.tone}>{label}</Badge>
          {!single && <span class="pk-sr-only"> on {entry.days.join(", ")}</span>}
        </li>
      ))}
    </ul>
  );
}
