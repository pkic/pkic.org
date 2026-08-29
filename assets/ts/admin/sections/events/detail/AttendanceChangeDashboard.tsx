import { StatCard } from "../../../../components/StatCard";
import { attendanceTypeLabel } from "../../../attendance";
import type { EventStatsResponse } from "../../../types";
import { fmt } from "../../../ui";

export function AttendanceChangeDashboard({
  slug,
  changes,
}: {
  slug: string;
  changes: EventStatsResponse["attendanceChanges"];
}) {
  const registrationsHref = `#/events/${slug}/registrations/attendance-changed`;
  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
          <div>
            <h6 class="text-uppercase small fw-bold text-muted mb-1">Attendance Movement</h6>
            <div class="small text-muted">
              Attendee totals count each person once. Day changes count each affected event day.
            </div>
          </div>
          <a class="btn btn-sm btn-outline-primary" href={registrationsHref}>
            Browse changed attendees →
          </a>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-6 col-xl-3">
            <StatCard
              label="Attendees changed"
              value={changes.changedAttendees}
              note="unique people across the event"
              href={registrationsHref}
            />
          </div>
          <div class="col-6 col-xl-3">
            <StatCard
              label="No longer in-person"
              value={changes.leftInPersonAttendees}
              note={`${changes.leftInPersonDayChanges} moves from in-person`}
              variant={changes.leftInPersonAttendees > 0 ? "warning" : "default"}
              href={`#/events/${slug}/registrations/left-in-person`}
            />
          </div>
          <div class="col-6 col-xl-3">
            <StatCard
              label="Now in-person"
              value={changes.joinedInPersonAttendees}
              note={`${changes.joinedInPersonDayChanges} moves to in-person`}
              variant={changes.joinedInPersonAttendees > 0 ? "success" : "default"}
              href={`#/events/${slug}/registrations/joined-in-person`}
            />
          </div>
          <div class="col-6 col-xl-3">
            <StatCard label="Day changes" value={changes.dayChanges} note="one attendee-day per change" />
          </div>
        </div>

        {changes.changedAttendees > 0 ? (
          <>
            <div class="row g-3">
              <div class="col-xl-7">
                <div class="small fw-semibold mb-2">Where attendance changed</div>
                <div class="tbl-wrap">
                  <table class="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th class="small">Event day</th>
                        <th class="text-end small">Attendees</th>
                        <th class="text-end small">No longer in-person</th>
                        <th class="text-end small">Now in-person</th>
                        <th class="text-end small">Day changes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.byDay.map((row) => (
                        <tr key={row.day_date}>
                          <td class="small">{row.label ?? row.day_date}</td>
                          <td class="mono text-end fw-semibold">{row.changed_attendees}</td>
                          <td class="mono text-end">{row.left_in_person_attendees}</td>
                          <td class="mono text-end">{row.joined_in_person_attendees}</td>
                          <td class="mono text-end text-muted">{row.day_changes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="col-xl-5">
                <div class="small fw-semibold mb-2">How attendance changed</div>
                <div class="tbl-wrap">
                  <table class="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th class="small">Change</th>
                        <th class="text-end small">Attendees</th>
                        <th class="text-end small">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.byTransition.map((row) => (
                        <tr key={`${row.from_type}->${row.to_type}`}>
                          <td class="small">
                            {attendanceTypeLabel(row.from_type)} → {attendanceTypeLabel(row.to_type)}
                          </td>
                          <td class="mono text-end fw-semibold">{row.attendees}</td>
                          <td class="mono text-end text-muted">{row.day_changes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="small fw-semibold mt-3 mb-2">Recent attendee changes</div>
            <div class="tbl-wrap">
              <table class="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th class="small">Attendee</th>
                    <th class="small">Event days</th>
                    <th class="small">Change</th>
                    <th class="small">When</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.recent.map((row) => (
                    <tr key={`${row.registration_id}:${row.changed_at}:${row.from_type}:${row.to_type}`}>
                      <td>
                        <a class="small fw-semibold" href={`#/events/${slug}/registrations/${row.registration_id}`}>
                          {row.display_name ?? row.user_email ?? row.registration_id}
                        </a>
                        {row.display_name && row.user_email && <div class="small text-muted">{row.user_email}</div>}
                      </td>
                      <td class="small">
                        {row.days.map((day) => day.label ?? day.day_date).join(", ")}
                        {row.days.length > 1 && <span class="text-muted"> ({row.days.length} days)</span>}
                      </td>
                      <td class="small">
                        {attendanceTypeLabel(row.from_type)} → {attendanceTypeLabel(row.to_type)}
                      </td>
                      <td class="mono small">{fmt(row.changed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p class="text-muted fst-italic small mb-0">No attendees have changed attendance after registration.</p>
        )}
      </div>
    </div>
  );
}
