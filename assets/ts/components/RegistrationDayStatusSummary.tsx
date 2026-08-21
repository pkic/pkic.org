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
    <div class="alert alert-warning mt-3 mb-0">
      <p class="fw-semibold mb-2">What is confirmed right now</p>
      <ul class="list-unstyled mb-2">
        {dayAttendance.map((entry) => {
          const dayLabel = entry.label ?? entry.dayDate;
          const waitlistStatus = waitlistByDay.get(entry.dayDate);

          let statusLabel: string;
          let statusClass = "text-bg-success";
          if (waitlistStatus === "offered") {
            statusLabel = "Spot available - review in manage page";
            statusClass = "text-bg-info";
          } else if (waitlistStatus === "waiting") {
            statusLabel = "In-person still pending";
            statusClass = "text-bg-warning";
          } else if (entry.attendanceType === "virtual") {
            statusLabel = "Virtual confirmed";
          } else if (entry.attendanceType === "on_demand") {
            statusLabel = "On-demand confirmed";
          } else {
            statusLabel = "In-person confirmed";
          }

          return (
            <li class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
              <span>{dayLabel}</span>
              <span class={`badge ${statusClass}`}>{statusLabel}</span>
            </li>
          );
        })}
      </ul>
      <p class="small mb-0">
        If this mix of confirmed and pending days no longer works for you, use the manage page to switch days, move to
        on-demand, or cancel the registration.
      </p>
    </div>
  );
}
