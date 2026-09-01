/**
 * What a partly-waitlisted registration actually has, day by day.
 *
 * The list is a description list rather than a stripped `ul` of flex rows: it
 * is a set of term/value pairs — a day and what is confirmed for it — and
 * `pk-datalist` lays those out in two columns without every row having to
 * re-derive the same flex declarations.
 *
 * Each status carries its meaning in words as well as in the badge's tone,
 * because a reader who cannot separate the hues gets nothing from the tone.
 */
import { Fragment } from "preact";

import { Alert } from "../ui/Alert";
import { Badge, type BadgeTone } from "../ui/Badge";
// `pk-datalist` is defined in Content.css, which ships in a lazy chunk rather
// than the entry stylesheet, so the module writing the class name imports it.
import "../ui/Content.css";

export interface RegistrationDayAttendanceSummaryItem {
  dayDate: string;
  attendanceType: string;
  label: string | null;
}

export interface RegistrationDayWaitlistSummaryItem {
  dayDate: string;
  status: string;
}

export function isPendingRegistrationDayWaitlistStatus(status: string): boolean {
  return status === "waiting" || status === "offered";
}

export function hasPendingRegistrationDayWaitlist(dayWaitlist: RegistrationDayWaitlistSummaryItem[]): boolean {
  return dayWaitlist.some((entry) => isPendingRegistrationDayWaitlistStatus(entry.status));
}

/** What one day's state says, and the tone that agrees with the words. */
function dayStatus(attendanceType: string, waitlistStatus: string | undefined): { label: string; tone: BadgeTone } {
  if (waitlistStatus === "offered") return { label: "Spot available — review in manage page", tone: "info" };
  if (waitlistStatus === "waiting") return { label: "In-person still pending", tone: "warn" };
  if (attendanceType === "virtual") return { label: "Virtual confirmed", tone: "ok" };
  if (attendanceType === "on_demand") return { label: "On-demand confirmed", tone: "ok" };
  return { label: "In-person confirmed", tone: "ok" };
}

export function RegistrationDayStatusSummary({
  dayAttendance,
  dayWaitlist,
}: {
  dayAttendance: RegistrationDayAttendanceSummaryItem[];
  dayWaitlist: RegistrationDayWaitlistSummaryItem[];
}) {
  if (dayAttendance.length === 0) return null;

  const waitlistByDay = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry.status] as const));

  return (
    <Alert tone="warn" title="What is confirmed right now">
      <div class="pk-stack pk-stack--snug">
        <dl class="pk-datalist">
          {dayAttendance.map((entry) => {
            const status = dayStatus(entry.attendanceType, waitlistByDay.get(entry.dayDate));
            return (
              <Fragment key={entry.dayDate}>
                <dt>{entry.label ?? entry.dayDate}</dt>
                <dd>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </dd>
              </Fragment>
            );
          })}
        </dl>
        <p class="pk-small">
          If this mix of confirmed and pending days no longer works for you, use the manage page to switch days, move to
          on-demand, or cancel the registration.
        </p>
      </div>
    </Alert>
  );
}
