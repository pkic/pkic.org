import { StatCard } from "../../../../components/StatCard";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { api } from "../../../api";
import { svgStackedBarChart, isoDateRange } from "../../../charts";
import type { EventStatsResponse } from "../../../types";
import { useData } from "../../../../hooks/useData";

const ATT_LABELS: Record<string, string> = {
  in_person: "In-person",
  virtual: "Virtual",
  on_demand: "On-demand",
  not_attending: "Not attending",
};
const ATT_COLORS: Record<string, string> = { in_person: "#0d6efd", virtual: "#198754", on_demand: "#fd7e14" };
const ATT_LIGHT_COLORS: Record<string, string> = { in_person: "#9ec5fe", virtual: "#a3cfbb", on_demand: "#fed8b1" };
const STATUS_COLORS: Record<string, string> = {
  registered: "#198754",
  pending_email_confirmation: "#fd7e14",
  waitlisted: "#0dcaf0",
  cancelled: "#dc3545",
};
const WAITLIST_STATUS_COLORS: Record<string, string> = {
  waiting: "#0d6efd",
  offered: "#fd7e14",
  accepted: "#198754",
  expired: "#6c757d",
  removed: "#dc3545",
};
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
  } = useData<EventStatsResponse>(() => api<EventStatsResponse>(`/api/v1/admin/events/${slug}/stats`), [slug]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!stats) return null;

  const s = stats;
  const confirmed = s.registrations?.byStatus?.registered ?? 0;
  const waitlisted = s.registrations?.byStatus?.waitlisted ?? 0;
  const consentGranted = s.registrations?.sponsorConsent?.granted ?? 0;
  const consentNotGranted = s.registrations?.sponsorConsent?.notGranted ?? 0;
  const consentTotal = consentGranted + consentNotGranted;
  const consentPct = consentTotal > 0 ? Math.round((consentGranted / consentTotal) * 100) : 0;
  const attendeePending = s.invites?.attendee?.byStatus?.sent ?? 0;
  const attendeeAccepted = s.invites?.attendee?.byStatus?.accepted ?? 0;
  const speakerPending = s.invites?.speaker?.byStatus?.sent ?? 0;
  const speakerAccepted = s.invites?.speaker?.byStatus?.accepted ?? 0;

  const growthByDay = s.registrations?.growthByDay ?? [];
  const waitlistByEventDay = s.waitlistByEventDay ?? [];
  const waitlistTotals = s.waitlistTotals ?? { total: 0, byStatus: {}, byPriorityLane: {} };
  const attendanceChanges = s.attendanceChanges ?? {
    totalChanges: 0,
    changedRegistrations: 0,
    byTransition: [],
    recent: [],
  };
  const registrationsByEventDay = s.registrationsByEventDay ?? [];
  const byStatusAndType = s.registrations?.byStatusAndType ?? [];

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
    label: ATT_LABELS[at] ?? at,
    color: ATT_COLORS[at] ?? "#6c757d",
    values: growthDates.map((d) => growthIdx[d]?.[at] ?? 0),
  }));

  // By-day chart
  const dayLabels = [...new Set(registrationsByEventDay.map((r) => r.label ?? r.day_date))];
  const dayAttTypes = [...new Set(registrationsByEventDay.map((r) => r.attendance_type))];
  const dayIdx: Record<string, Record<string, { confirmed: number; pending: number }>> = {};
  for (const r of registrationsByEventDay) {
    const lbl = r.label ?? r.day_date;
    dayIdx[lbl] ??= {};
    dayIdx[lbl][r.attendance_type] ??= { confirmed: 0, pending: 0 };
    if (r.status === "registered") dayIdx[lbl][r.attendance_type].confirmed += r.count;
    else dayIdx[lbl][r.attendance_type].pending += r.count;
  }
  const daySeries = dayAttTypes
    .flatMap((at) => [
      {
        label: `${ATT_LABELS[at] ?? at} – Confirmed`,
        color: ATT_COLORS[at] ?? "#6c757d",
        values: dayLabels.map((lbl) => dayIdx[lbl]?.[at]?.confirmed ?? 0),
      },
      {
        label: `${ATT_LABELS[at] ?? at} – Pending`,
        color: ATT_LIGHT_COLORS[at] ?? "#ced4da",
        values: dayLabels.map((lbl) => dayIdx[lbl]?.[at]?.pending ?? 0),
      },
    ])
    .filter((sr) => sr.values.some((v) => v > 0));

  // Waitlist-by-day chart/table
  const waitlistDayLabels = [...new Set(waitlistByEventDay.map((r) => r.label ?? r.day_date))];
  const waitlistStatuses = [...new Set(waitlistByEventDay.map((r) => r.status))];
  const waitlistDayIdx: Record<string, Record<string, { total: number; continuity: number; general: number }>> = {};
  for (const r of waitlistByEventDay) {
    const lbl = r.label ?? r.day_date;
    waitlistDayIdx[lbl] ??= {};
    waitlistDayIdx[lbl][r.status] ??= { total: 0, continuity: 0, general: 0 };
    waitlistDayIdx[lbl][r.status].total += r.count;
    if (r.priority_lane === "continuity") waitlistDayIdx[lbl][r.status].continuity += r.count;
    else waitlistDayIdx[lbl][r.status].general += r.count;
  }
  const waitlistSeries = waitlistStatuses
    .map((status) => ({
      label: status,
      color: WAITLIST_STATUS_COLORS[status] ?? "#6c757d",
      values: waitlistDayLabels.map((lbl) => waitlistDayIdx[lbl]?.[status]?.total ?? 0),
    }))
    .filter((sr) => sr.values.some((v) => v > 0));
  const waitlistOpenCount = (waitlistTotals.byStatus?.waiting ?? 0) + (waitlistTotals.byStatus?.offered ?? 0);
  const waitlistAcceptedCount = waitlistTotals.byStatus?.accepted ?? 0;
  const waitlistOfferedCount = waitlistTotals.byStatus?.offered ?? 0;
  const waitlistAcceptanceRate =
    waitlistOfferedCount > 0 ? Math.round((waitlistAcceptedCount / waitlistOfferedCount) * 100) : 0;

  // Cross status x attendance
  const crossStatuses = [...new Set(byStatusAndType.map((r) => r.status))];
  const crossAttTypes = [...new Set(byStatusAndType.map((r) => r.attendance_type))];
  const crossIdx: Record<string, Record<string, number>> = {};
  for (const r of byStatusAndType) {
    crossIdx[r.status] ??= {};
    crossIdx[r.status][r.attendance_type] = r.count;
  }
  const statusSeries = crossStatuses.map((st) => ({
    label: st,
    color: STATUS_COLORS[st] ?? "#6c757d",
    values: crossAttTypes.map((at) => crossIdx[st]?.[at] ?? 0),
  }));

  return (
    <div>
      <div class="d-flex justify-content-end mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={() => void reload()}>
          ↺ Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div class="row g-3 mb-3">
        <div class="col-6 col-md-3">
          <StatCard label="Confirmed" value={confirmed} note="registered" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Waitlisted" value={waitlisted} note="waiting" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Total Registrations" value={s.registrations?.total ?? 0} note="all statuses" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Proposals" value={s.proposals?.total ?? 0} note="submitted" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Attendee Invites Pending" value={attendeePending} note="sent, not accepted" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Attendee Invites Accepted" value={attendeeAccepted} note="" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Speaker Invites Pending" value={speakerPending} note="" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Speaker Invites Accepted" value={speakerAccepted} note="" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Day Waitlist Open" value={waitlistOpenCount} note="waiting + offered" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard
            label="Day Waitlist Accepted"
            value={waitlistAcceptedCount}
            note={`${waitlistAcceptanceRate}% of offered`}
          />
        </div>
        <div class="col-6 col-md-3">
          <StatCard label="Attendance Changes" value={attendanceChanges.totalChanges} note="from one type to another" />
        </div>
        <div class="col-6 col-md-3">
          <StatCard
            label="Registrations Changed"
            value={attendanceChanges.changedRegistrations}
            note="unique registrations"
          />
        </div>
      </div>

      {/* Consent */}
      <div class="row g-3 mb-3">
        <div class="col-md-12">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-2">Sponsor Data-Sharing Consent</h6>
              <div class="display-6 fw-semibold lh-1">{consentGranted}</div>
              <div class="small text-muted mt-1">
                {consentPct}% granted ({consentNotGranted} not granted)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Registration growth chart */}
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-2">Registration Growth</h6>
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

      {/* Cross-status breakdown */}
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-2">Status × Attendance Type</h6>
          {crossStatuses.length > 0 && (
            <div
              dangerouslySetInnerHTML={{
                __html: svgStackedBarChart(
                  crossAttTypes.map((at) => ATT_LABELS[at] ?? at),
                  statusSeries,
                ),
              }}
            />
          )}
          {crossStatuses.length > 0 ? (
            <div class="tbl-wrap mt-3">
              <table class="table table-sm align-middle mb-0">
                <thead class="table-dark">
                  <tr>
                    <th class="small">Status</th>
                    {crossAttTypes.map((at) => (
                      <th key={at} class="text-end small">
                        {ATT_LABELS[at] ?? at}
                      </th>
                    ))}
                    <th class="text-end small">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {crossStatuses.map((st) => {
                    const rowTotal = crossAttTypes.reduce((sum, at) => sum + (crossIdx[st]?.[at] ?? 0), 0);
                    return (
                      <tr key={st}>
                        <td>
                          <span class="badge text-bg-secondary">{st}</span>
                        </td>
                        {crossAttTypes.map((at) => (
                          <td key={at} class="text-end mono">
                            {crossIdx[st]?.[at] ?? 0}
                          </td>
                        ))}
                        <td class="text-end mono fw-semibold">{rowTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr class="table-light fw-semibold">
                    <td class="small">Total</td>
                    {crossAttTypes.map((at) => (
                      <td key={at} class="text-end mono">
                        {crossStatuses.reduce((sum, st) => sum + (crossIdx[st]?.[at] ?? 0), 0)}
                      </td>
                    ))}
                    <td class="text-end mono">{s.registrations?.total ?? 0}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p class="text-muted fst-italic small">No data</p>
          )}
        </div>
      </div>

      {/* Per-day registrations */}
      {dayLabels.length > 0 && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <h6 class="text-uppercase small fw-bold text-muted mb-2">Registrations by Event Day</h6>
            <div class="text-muted small mb-2">
              <span class="text-success fw-semibold">solid = confirmed</span>,{" "}
              <span class="text-secondary fw-semibold">light = pending/waitlisted</span>
            </div>
            <div dangerouslySetInnerHTML={{ __html: svgStackedBarChart(dayLabels, daySeries) }} />
          </div>
        </div>
      )}

      {/* Per-day waitlist */}
      {waitlistDayLabels.length > 0 && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-body">
            <h6 class="text-uppercase small fw-bold text-muted mb-2">Waitlist by Event Day</h6>
            <div class="text-muted small mb-2">
              Open queue: <strong>{waitlistOpenCount}</strong> (waiting + offered) • Total entries:{" "}
              {waitlistTotals.total}
            </div>
            <div class="text-muted small mb-2">
              Overall conversion: accepted/offered ={" "}
              <strong>
                {waitlistAcceptedCount}/{waitlistOfferedCount || 0}
              </strong>{" "}
              ({waitlistAcceptanceRate}%)
            </div>
            {waitlistSeries.length > 0 && (
              <div dangerouslySetInnerHTML={{ __html: svgStackedBarChart(waitlistDayLabels, waitlistSeries) }} />
            )}

            <div class="tbl-wrap mt-3">
              <table class="table table-sm align-middle mb-0">
                <thead class="table-dark">
                  <tr>
                    <th class="small">Day</th>
                    <th class="text-end small">Waiting</th>
                    <th class="text-end small">Offered</th>
                    <th class="text-end small">Accepted</th>
                    <th class="text-end small">Expired</th>
                    <th class="text-end small">Removed</th>
                    <th class="text-end small">Accepted/Offered</th>
                    <th class="text-end small">Continuity</th>
                    <th class="text-end small">General</th>
                    <th class="text-end small">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {waitlistDayLabels.map((lbl) => {
                    const waiting = waitlistDayIdx[lbl]?.waiting?.total ?? 0;
                    const offered = waitlistDayIdx[lbl]?.offered?.total ?? 0;
                    const accepted = waitlistDayIdx[lbl]?.accepted?.total ?? 0;
                    const expired = waitlistDayIdx[lbl]?.expired?.total ?? 0;
                    const removed = waitlistDayIdx[lbl]?.removed?.total ?? 0;
                    const conversion = offered > 0 ? Math.round((accepted / offered) * 100) : 0;
                    const continuity = waitlistStatuses.reduce(
                      (sum, st) => sum + (waitlistDayIdx[lbl]?.[st]?.continuity ?? 0),
                      0,
                    );
                    const general = waitlistStatuses.reduce(
                      (sum, st) => sum + (waitlistDayIdx[lbl]?.[st]?.general ?? 0),
                      0,
                    );
                    const total = waiting + offered + accepted + expired + removed;
                    return (
                      <tr key={lbl}>
                        <td class="small">{lbl}</td>
                        <td class="mono text-end">{waiting}</td>
                        <td class="mono text-end">{offered}</td>
                        <td class="mono text-end">{accepted}</td>
                        <td class="mono text-end">{expired}</td>
                        <td class="mono text-end">{removed}</td>
                        <td class="mono text-end">{offered > 0 ? `${accepted}/${offered} (${conversion}%)` : "—"}</td>
                        <td class="mono text-end">{continuity}</td>
                        <td class="mono text-end">{general}</td>
                        <td class="mono text-end fw-semibold">{total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Attendance change activity */}
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-2">Day Attendance Change Activity</h6>
          <div class="row g-3">
            <div class="col-md-5">
              <div class="small fw-semibold mb-2">Transitions (from → to)</div>
              {attendanceChanges.byTransition.length > 0 ? (
                <table class="table table-sm mb-0">
                  <thead>
                    <tr>
                      <th class="small">From</th>
                      <th class="small">To</th>
                      <th class="text-end small">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceChanges.byTransition.map((row) => (
                      <tr key={`${row.from_type}->${row.to_type}`}>
                        <td class="small">{ATT_LABELS[row.from_type] ?? row.from_type}</td>
                        <td class="small">{ATT_LABELS[row.to_type] ?? row.to_type}</td>
                        <td class="mono text-end">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p class="text-muted fst-italic small mb-0">No attendance changes recorded.</p>
              )}
            </div>
            <div class="col-md-7">
              <div class="small fw-semibold mb-2">Recently changed attendees</div>
              {attendanceChanges.recent.length > 0 ? (
                <div class="tbl-wrap">
                  <table class="table table-sm mb-0">
                    <thead>
                      <tr>
                        <th class="small">Attendee</th>
                        <th class="small">Day</th>
                        <th class="small">Change</th>
                        <th class="small">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendanceChanges.recent.map((row) => (
                        <tr key={`${row.registration_id}:${row.changed_at}`}>
                          <td>
                            <div class="small fw-semibold">
                              {row.display_name ?? row.user_email ?? row.registration_id}
                            </div>
                            {row.display_name && row.user_email && <div class="small text-muted">{row.user_email}</div>}
                          </td>
                          <td class="small">{row.day_label ?? row.day_date}</td>
                          <td class="small">
                            {ATT_LABELS[row.from_type] ?? row.from_type} → {ATT_LABELS[row.to_type] ?? row.to_type}
                          </td>
                          <td class="mono small">{row.changed_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p class="text-muted fst-italic small mb-0">No recent changes.</p>
              )}
            </div>
          </div>
        </div>
      </div>

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
