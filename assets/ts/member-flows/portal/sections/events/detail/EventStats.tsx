import { StatCard } from "../../../../../components/StatCard";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson } from "../../../../../shared/api-client";
import { eventAnalyticsResponseSchema } from "../../../../../../shared/schemas/event-analytics";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../attendance";
import { svgStackedBarChart, isoDateRange } from "../../../../../components/analytics/charts";
import type { EventStatsResponse } from "../types";
import { useData } from "../../../../../hooks/useData";
import { AttendanceChangeDashboard } from "./AttendanceChangeDashboard";

const ATT_COLORS: Record<string, string> = { in_person: "#0d6efd", virtual: "#198754", on_demand: "#fd7e14" };
const ATT_LIGHT_COLORS: Record<string, string> = { in_person: "#9ec5fe", virtual: "#a3cfbb", on_demand: "#fed8b1" };
const INVITE_BADGE: Record<string, [string, string]> = {
  sent: ["info", "Pending"],
  accepted: ["success", "Accepted"],
  declined: ["danger", "Declined"],
  expired: ["secondary", "Expired"],
  revoked: ["warning", "Revoked"],
};

function inviteBadge(status: string) {
  const [colour, label] = INVITE_BADGE[status] ?? ["secondary", status];
  return <span class={`badge text-bg-${colour}`}>{label}</span>;
}

export function EventStats({ slug }: { slug: string }) {
  const {
    data: stats,
    loading,
    error,
    reload,
  } = useData<EventStatsResponse>(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/analytics`, eventAnalyticsResponseSchema),
    [slug],
  );

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!stats) return null;

  const s = stats;
  const consentGranted = s.registrations?.sponsorConsent?.granted ?? 0;
  const consentNotGranted = s.registrations?.sponsorConsent?.notGranted ?? 0;
  const consentTotal = consentGranted + consentNotGranted;
  const consentPct = consentTotal > 0 ? Math.round((consentGranted / consentTotal) * 100) : 0;
  const pendingConfirmation = s.registrations?.byStatus?.pending_email_confirmation ?? 0;

  const growthByDay = s.registrations?.growthByDay ?? [];
  const waitlistByEventDay = s.waitlistByEventDay ?? [];
  const waitlistTotals = s.waitlistTotals ?? { total: 0, byStatus: {}, byPriorityLane: {} };
  const attendanceChanges = s.attendanceChanges ?? {
    totalChanges: 0,
    changedRegistrations: 0,
    dayChanges: 0,
    changedAttendees: 0,
    leftInPersonAttendees: 0,
    leftInPersonDayChanges: 0,
    joinedInPersonAttendees: 0,
    joinedInPersonDayChanges: 0,
    byTransition: [],
    byDay: [],
    recent: [],
  };
  const registrationsByEventDay = s.registrationsByEventDay ?? [];
  const attendanceTypes = new Set(
    [...Object.keys(ATTENDANCE_TYPE_LABELS), ...Object.keys(s.registrations?.attendanceStatusByType ?? {})].filter(
      (type) => type !== "not_attending",
    ),
  );
  const attendanceStatuses = [...attendanceTypes].map((type) => ({
    type,
    label: attendanceTypeLabel(type),
    accepted: s.registrations?.attendanceStatusByType?.[type]?.accepted ?? 0,
    waitlisted: s.registrations?.attendanceStatusByType?.[type]?.waitlisted ?? 0,
  }));
  const waitlistedAttendees = attendanceStatuses.reduce((sum, item) => sum + item.waitlisted, 0);
  const acceptedAttendees = attendanceStatuses.reduce((sum, item) => sum + item.accepted, 0);

  // Growth chart
  const growthDates = (() => {
    const raw = [...new Set(growthByDay.map((r) => r.date))].sort();
    return raw.length > 1 ? isoDateRange(raw[0], raw[raw.length - 1]) : raw;
  })();
  const allAttTypes = [...new Set(growthByDay.map((r) => r.attendance_type))];
  const growthIdx: Record<string, Record<string, number>> = {};
  for (const r of growthByDay) {
    growthIdx[r.date] ??= {};
    growthIdx[r.date][r.attendance_type] = (growthIdx[r.date][r.attendance_type] ?? 0) + r.count;
  }
  const growthSeries = allAttTypes.map((at) => ({
    label: attendanceTypeLabel(at),
    color: ATT_COLORS[at] ?? "#6c757d",
    values: growthDates.map((d) => growthIdx[d]?.[at] ?? 0),
  }));

  // By-day chart
  const dayLabels = [...new Set(registrationsByEventDay.map((r) => r.label ?? r.day_date))];
  const dayAttTypes = [...new Set(registrationsByEventDay.map((r) => r.attendance_type))];
  const dayIdx: Record<string, Record<string, { accepted: number; pending: number }>> = {};
  for (const r of registrationsByEventDay) {
    const lbl = r.label ?? r.day_date;
    dayIdx[lbl] ??= {};
    dayIdx[lbl][r.attendance_type] ??= { accepted: 0, pending: 0 };
    if (r.attendance_status === "accepted") dayIdx[lbl][r.attendance_type].accepted += r.count;
    else dayIdx[lbl][r.attendance_type].pending += r.count;
  }
  const daySeries = dayAttTypes
    .flatMap((at) => [
      {
        label: `${attendanceTypeLabel(at)} – Accepted`,
        color: ATT_COLORS[at] ?? "#6c757d",
        values: dayLabels.map((lbl) => dayIdx[lbl]?.[at]?.accepted ?? 0),
      },
      {
        label: `${attendanceTypeLabel(at)} – Pending`,
        color: ATT_LIGHT_COLORS[at] ?? "#ced4da",
        values: dayLabels.map((lbl) => dayIdx[lbl]?.[at]?.pending ?? 0),
      },
    ])
    .filter((sr) => sr.values.some((v) => v > 0));

  // Waitlist-by-day chart/table
  const waitlistDayLabels = [...new Set(waitlistByEventDay.map((r) => r.label ?? r.day_date))];
  const waitlistDayIdx: Record<string, Record<string, number>> = {};
  for (const r of waitlistByEventDay) {
    const lbl = r.label ?? r.day_date;
    waitlistDayIdx[lbl] ??= {};
    waitlistDayIdx[lbl][r.status] = (waitlistDayIdx[lbl][r.status] ?? 0) + r.count;
  }
  const waitlistOpenCount = (waitlistTotals.byStatus?.waiting ?? 0) + (waitlistTotals.byStatus?.offered ?? 0);
  const waitlistAcceptedCount = waitlistTotals.byStatus?.accepted ?? 0;
  const waitlistOfferedCount = waitlistTotals.byStatus?.offered ?? 0;

  return (
    <div>
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h5 class="mb-1">Event dashboard</h5>
          <div class="small text-muted">Current attendee status, movement, waitlist pressure, and event activity.</div>
        </div>
        <button class="btn btn-sm btn-outline-secondary" onClick={() => void reload()}>
          ↺ Refresh
        </button>
      </div>

      {/* At-a-glance status */}
      <div class="row g-3 mb-3">
        <div class="col-6 col-md-4 col-xl-2">
          <StatCard label="Accepted attendees" value={acceptedAttendees} note="not on an active waitlist" />
        </div>
        <div class="col-6 col-md-4 col-xl-2">
          <StatCard
            label="Waitlisted attendees"
            value={waitlistedAttendees}
            note="unique people with an active day waitlist"
            variant={waitlistedAttendees > 0 ? "warning" : "default"}
          />
        </div>
        <div class="col-6 col-md-4 col-xl-2">
          <StatCard
            label="Pending confirmation"
            value={pendingConfirmation}
            note="email not confirmed"
            variant={pendingConfirmation > 0 ? "warning" : "default"}
          />
        </div>
        <div class="col-6 col-md-4 col-xl-2">
          <StatCard label="Total registrations" value={s.registrations?.total ?? 0} note="all statuses" />
        </div>
        {s.proposals && (
          <div class="col-6 col-md-4 col-xl-2">
            <StatCard label="Proposals" value={s.proposals.total} note="all proposal statuses" />
          </div>
        )}
        <div class="col-6 col-md-4 col-xl-2">
          <StatCard label="Sponsor consent" value={consentGranted} note={`${consentPct}% of ${consentTotal}`} />
        </div>
      </div>

      {/* Accepted and waitlisted attendance by type */}
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-2">Attendance Status</h6>
          <div class="row g-3">
            {attendanceStatuses.map(({ type, label, accepted, waitlisted }) => (
              <div key={type} class="col-6 col-md-4">
                <StatCard
                  label={`${label} accepted`}
                  value={accepted}
                  note={waitlisted > 0 ? `+${waitlisted} waitlisted` : "No active waitlist"}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <AttendanceChangeDashboard slug={slug} changes={attendanceChanges} />

      {/* Registration growth chart */}
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-2">Registrations Received by Day</h6>
          {growthDates.length > 0 ? (
            <div
              dangerouslySetInnerHTML={{
                __html: svgStackedBarChart(
                  growthDates.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`),
                  growthSeries,
                  { isoLabels: growthDates },
                ),
              }}
            />
          ) : (
            <p class="text-muted fst-italic small">No registrations yet.</p>
          )}
        </div>
      </div>

      {/* Per-day registrations */}
      {dayLabels.length > 0 && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <h6 class="text-uppercase small fw-bold text-muted mb-2">Registrations by Event Day</h6>
            <div class="text-muted small mb-2">
              <span class="text-success fw-semibold">solid = accepted</span>,{" "}
              <span class="text-secondary fw-semibold">light = pending/waitlisted</span>
            </div>
            <div dangerouslySetInnerHTML={{ __html: svgStackedBarChart(dayLabels, daySeries) }} />
          </div>
        </div>
      )}

      {/* Operational waitlist */}
      {waitlistDayLabels.length > 0 && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <h6 class="text-uppercase small fw-bold text-muted mb-2">Open Waitlist by Event Day</h6>
            <div class="row g-3 mb-3">
              <div class="col-6 col-md-4">
                <StatCard label="Open day entries" value={waitlistOpenCount} note="waiting + offered" />
              </div>
              <div class="col-6 col-md-4">
                <StatCard
                  label="Offers awaiting response"
                  value={waitlistOfferedCount}
                  note="included in open entries"
                />
              </div>
              <div class="col-6 col-md-4">
                <StatCard label="Accepted from waitlist" value={waitlistAcceptedCount} note="historical total" />
              </div>
            </div>
            <div class="tbl-wrap">
              <table class="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th class="small">Event day</th>
                    <th class="text-end small">Waiting</th>
                    <th class="text-end small">Offered</th>
                    <th class="text-end small">Open now</th>
                    <th class="text-end small">Accepted historically</th>
                  </tr>
                </thead>
                <tbody>
                  {waitlistDayLabels.map((lbl) => {
                    const waiting = waitlistDayIdx[lbl]?.waiting ?? 0;
                    const offered = waitlistDayIdx[lbl]?.offered ?? 0;
                    const accepted = waitlistDayIdx[lbl]?.accepted ?? 0;
                    return (
                      <tr key={lbl}>
                        <td class="small">{lbl}</td>
                        <td class="mono text-end">{waiting}</td>
                        <td class="mono text-end">{offered}</td>
                        <td class="mono text-end fw-semibold">{waiting + offered}</td>
                        <td class="mono text-end text-muted">{accepted}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Invites breakdown */}
      <div class="row g-3 mb-3">
        {(["attendee", "speaker"] as const).map((type) => {
          const inv = s.invites?.[type];
          if (!inv) return null;
          const declineReasons = inv.declineReasons ?? [];
          return (
            <div key={type} class="col-md-6">
              <div class="card border-0 shadow-sm h-100">
                <div class="card-body">
                  <h6 class="text-uppercase small fw-bold text-muted mb-2">
                    {type === "attendee" ? "Attendee" : "Speaker"} Invites
                  </h6>
                  <div class="tbl-wrap">
                    <table class="table table-sm mb-0">
                      <tbody>
                        {Object.entries(inv.byStatus ?? {}).map(([status, count]) => (
                          <tr key={status}>
                            <td>{inviteBadge(status)}</td>
                            <td class="mono text-end">{count}</td>
                          </tr>
                        ))}
                        <tr class="table-light fw-semibold">
                          <td class="small">Total</td>
                          <td class="mono text-end">{inv.total ?? 0}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {declineReasons.length > 0 && (
                    <>
                      <div class="small fw-semibold mt-2 mb-1">Decline reasons</div>
                      <table class="table table-sm mb-0">
                        <thead>
                          <tr>
                            <th class="small">Reason</th>
                            <th class="text-end small">Count</th>
                            <th class="text-end small">Unsub</th>
                          </tr>
                        </thead>
                        <tbody>
                          {declineReasons.map((dr, i) => (
                            <tr key={i}>
                              <td class="small">{dr.reason_code ?? "Not specified"}</td>
                              <td class="mono text-end">{dr.count}</td>
                              <td class="mono text-end">{dr.unsubscribed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* RSVP data */}
      {(s.rsvp?.total ?? 0) > 0 && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <h6 class="text-uppercase small fw-bold text-muted mb-2">Calendar RSVP ({s.rsvp.total})</h6>
            <div class="row g-2">
              <div class="col-md-6">
                <div class="small fw-semibold mb-1">By Status</div>
                <table class="table table-sm mb-0">
                  <tbody>
                    {Object.entries(s.rsvp.byStatus ?? {}).map(([st, cnt]) => (
                      <tr key={st}>
                        <td class="small">{st}</td>
                        <td class="mono text-end">{cnt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Object.keys(s.rsvp.actionsTaken ?? {}).length > 0 && (
                <div class="col-md-6">
                  <div class="small fw-semibold mb-1">Actions Taken</div>
                  <table class="table table-sm mb-0">
                    <tbody>
                      {Object.entries(s.rsvp.actionsTaken ?? {}).map(([action, cnt]) => (
                        <tr key={action}>
                          <td class="small">{action}</td>
                          <td class="mono text-end">{cnt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
