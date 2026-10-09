/**
 * Where a registration stands, day by day — the one summary every
 * registration screen shows: the public result and confirmation pages, the
 * capability manage page and the portal.
 *
 * Days are grouped by what they amount to (`groupRegistrationDays`), so three
 * confirmed in-person days read as one line, and only a difference splits
 * them. A waiting-list place is its own amber line that says so in words; an
 * offered seat leads, with the claim when the screen can act on it.
 */
import { formatDateTime, formatDayList } from "../../shared/format-date";
import { attendanceTypeLabel } from "../shared/attendance";
import { groupRegistrationDays, hasWaitingDays, type DayStatusGroup } from "../shared/registration-day-status";
import { Button } from "../ui/Button";
import { AttendanceIcon } from "./DayAttendancePicker";
import "./RegistrationDayStatusSummary.css";

export interface RegistrationDayAttendanceSummaryItem {
  dayDate: string;
  attendanceType: string;
  label: string | null;
}

export interface RegistrationDayWaitlistSummaryItem {
  dayDate: string;
  status: string;
  offerExpiresAt?: string | null;
}

export function isPendingRegistrationDayWaitlistStatus(status: string): boolean {
  return status === "waiting" || status === "offered";
}

export function hasPendingRegistrationDayWaitlist(dayWaitlist: RegistrationDayWaitlistSummaryItem[]): boolean {
  return dayWaitlist.some((entry) => isPendingRegistrationDayWaitlistStatus(entry.status));
}

function whichDays(group: DayStatusGroup, total: number): string {
  if (group.dayDates.length === total && total > 1) return `All ${total} days`;
  return formatDayList(group.dayDates);
}

function GroupRow({
  group,
  total,
  busy,
  onClaim,
}: {
  group: DayStatusGroup;
  total: number;
  busy: boolean;
  onClaim?: (dayDates: string[]) => void;
}) {
  const title =
    group.kind === "offered"
      ? "An in-person seat is yours to claim"
      : group.kind === "waiting"
        ? "On the waiting list for an in-person seat"
        : attendanceTypeLabel(group.attendanceType);
  return (
    <li class="pk-day-status__row" data-kind={group.kind}>
      <span class="pk-day-status__icon">
        <AttendanceIcon type={group.kind === "confirmed" ? group.attendanceType : "in_person"} />
      </span>
      <span class="pk-day-status__body">
        <span class="pk-day-status__title">{title}</span>
        <span class="pk-day-status__days">{whichDays(group, total)}</span>
        {group.kind === "waiting" && (
          <span class="pk-small">You stay registered. We email you as soon as a seat opens.</span>
        )}
        {group.kind === "offered" && group.offerExpiresAt && (
          <span class="pk-small">Claim it before {formatDateTime(group.offerExpiresAt)}.</span>
        )}
      </span>
      {group.kind === "offered" && onClaim && (
        <Button variant="primary" size="sm" loading={busy} onClick={() => onClaim(group.dayDates)}>
          Claim seat
        </Button>
      )}
    </li>
  );
}

export function RegistrationDayStatusSummary({
  dayAttendance,
  dayWaitlist,
  busy = false,
  onClaim,
}: {
  dayAttendance: RegistrationDayAttendanceSummaryItem[];
  dayWaitlist: RegistrationDayWaitlistSummaryItem[];
  busy?: boolean;
  /** Where the screen can act on an offered seat; without it the offer is stated only. */
  onClaim?: (dayDates: string[]) => void;
}) {
  if (dayAttendance.length === 0) return null;
  const groups = groupRegistrationDays(dayAttendance, dayWaitlist);
  return (
    <ul
      class="pk-day-status"
      data-waiting={hasWaitingDays(groups) ? "true" : undefined}
      aria-label="Your registration, day by day"
    >
      {groups.map((group) => (
        <GroupRow
          key={`${group.kind}:${group.attendanceType ?? ""}`}
          group={group}
          total={dayAttendance.length}
          busy={busy}
          onClaim={onClaim}
        />
      ))}
    </ul>
  );
}
