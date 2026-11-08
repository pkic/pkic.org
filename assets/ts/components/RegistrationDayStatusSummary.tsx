import { REGISTRATION_DAY_WAITLIST_DISPLAY } from "../../shared/status-display";
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
import { attendanceIconName } from "../../shared/event-attendance-icons";
import { attendanceTypeLabel } from "../shared/attendance";
import { groupRegistrationDays, hasWaitingDays, type DayStatusGroup } from "../shared/registration-day-status";
import { Button } from "../ui/Button";
import { AttendanceIcon } from "./AttendanceIcon";
import { IconRemove } from "./icons";
import "./RegistrationDayStatusSummary.css";

export interface RegistrationDayAttendanceSummaryItem {
  dayDate: string;
  attendanceType: string;
  label: string | null;
  optionLabel?: string | null;
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
  const option = group.optionLabel ?? attendanceTypeLabel(group.attendanceType);
  const hasIcon =
    group.kind === "cancelled" || Boolean(group.attendanceType && attendanceIconName(group.attendanceType) !== "none");
  const display =
    group.kind === "confirmed" || group.kind === "cancelled" ? null : REGISTRATION_DAY_WAITLIST_DISPLAY[group.kind];
  const title = display
    ? `${display.label}${group.attendanceType ? `: ${option}` : ""}`
    : group.kind === "cancelled"
      ? "Cancelled"
      : option;
  return (
    <li class="pk-day-status__row" data-kind={group.kind} data-icon={hasIcon ? undefined : "none"}>
      {hasIcon && (
        <span class="pk-day-status__icon">
          {group.kind === "cancelled" ? <IconRemove /> : <AttendanceIcon type={group.attendanceType} />}
        </span>
      )}
      <span class="pk-day-status__body">
        <span class="pk-day-status__title">{title}</span>
        <span class="pk-day-status__days">{whichDays(group, total)}</span>
        {group.kind === "waiting" && (
          <span class="pk-small">You stay registered. We email you when a place is available.</span>
        )}
        {group.kind === "expired" && (
          <span class="pk-small">Update and save your attendance to request a place again.</span>
        )}
        {group.kind === "offered" && group.offerExpiresAt && (
          <span class="pk-small">Claim it before {formatDateTime(group.offerExpiresAt)}.</span>
        )}
      </span>
      {group.kind === "offered" && onClaim && (
        <Button variant="primary" loading={busy} onClick={() => onClaim(group.dayDates)}>
          Claim place
        </Button>
      )}
    </li>
  );
}

export function RegistrationDayStatusSummary({
  dayAttendance,
  dayWaitlist,
  busy = false,
  cancelled = false,
  onClaim,
}: {
  dayAttendance: RegistrationDayAttendanceSummaryItem[];
  dayWaitlist: RegistrationDayWaitlistSummaryItem[];
  busy?: boolean;
  /** The whole registration is cancelled: its days read as cancelled, not as places held. */
  cancelled?: boolean;
  /** Where the screen can act on an offered seat; without it the offer is stated only. */
  onClaim?: (dayDates: string[]) => void;
}) {
  const groups = groupRegistrationDays(dayAttendance, dayWaitlist, { cancelled });
  if (groups.length === 0) return null;
  return (
    <ul
      class="pk-day-status"
      data-waiting={hasWaitingDays(groups) ? "true" : undefined}
      aria-label="Your registration, day by day"
    >
      {groups.map((group) => (
        <GroupRow
          key={JSON.stringify([group.kind, group.attendanceType, group.optionLabel])}
          group={group}
          total={dayAttendance.length}
          busy={busy}
          onClaim={onClaim}
        />
      ))}
    </ul>
  );
}
