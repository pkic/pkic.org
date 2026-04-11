import { badge, esc, q, spinner, tbl } from "./ui";
import { isoDateRange, svgStackedBarChart, svgStatusSegmentBar } from "./charts";

export interface EventStatsResponse {
  event: { id: string; slug: string; name: string };
  registrations: {
    byStatus: Record<string, number>;
    byAttendanceType: Record<string, number>;
    byStatusAndType: Array<{ status: string; attendance_type: string; count: number }>;
    total: number;
    growthByDay: Array<{ date: string; attendance_type: string; count: number }>;
  };
  registrationsByEventDay: Array<{ day_date: string; label: string | null; sort_order: number; attendance_type: string; status: string; count: number }>;
  invites: {
    attendee: { byStatus: Record<string, number>; total: number; declineReasons: Array<{ reason_code: string | null; count: number; unsubscribed: number }> };
    speaker: { byStatus: Record<string, number>; total: number; declineReasons: Array<{ reason_code: string | null; count: number; unsubscribed: number }> };
  };
  proposals: { byStatus: Record<string, number>; total: number };
  rsvp: {
    total: number;
    byStatus: Record<string, number>;
    byProvider: Record<string, number>;
    actionsTaken: Record<string, number>;
  };
}

interface EventStatsSectionDeps {
  api<T = unknown>(path: string, opts?: RequestInit & { headers?: Record<string, string> }): Promise<T>;
}

function sc(lbl: string, val: number, note: string): string {
  return (
    `<div class="stat-card">` +
    `<div class="val">${val}</div>` +
    `<div class="lbl">${esc(lbl)}</div>` +
    `<div class="note">${esc(note)}</div></div>`
  );
}

function inviteBadge(status: string): string {
  const map: Record<string, [string, string]> = {
    sent: ["info", "Pending"],
    accepted: ["success", "Accepted"],
    declined: ["danger", "Declined"],
    expired: ["secondary", "Expired"],
    revoked: ["warning", "Revoked"],
  };
  const [color, label] = map[status] ?? ["secondary", status];
  return `<span class="badge text-bg-${color}">${esc(label)}</span>`;
}

export function eventStatsTabHtml(): string {
  return (
    '<div class="d-flex justify-content-end mb-3">' +
      '<button class="btn btn-sm btn-outline-secondary" id="btn-event-stats-refresh">&circlearrowright; Refresh</button>' +
    '</div>' +
    '<div id="event-stats-body">' + spinner() + '</div>'
  );
}

export async function loadEventStats(api: EventStatsSectionDeps["api"], slug: string): Promise<void> {
  const body = q("#event-stats-body");
  if (!body) return;

  const refreshBtn = q<HTMLButtonElement>("#btn-event-stats-refresh");

  const doLoad = async (): Promise<void> => {
    body.innerHTML = spinner();
    try {
      const s = await api<EventStatsResponse>(`/api/v1/admin/events/${slug}/stats`);

      const attLabels: Record<string, string> = { in_person: "In person", virtual: "Virtual", on_demand: "On demand" };
      const attColors: Record<string, string> = { in_person: "#0d6efd", virtual: "#198754", on_demand: "#fd7e14" };
      const statusColors: Record<string, string> = {
        registered: "#198754",
        pending_email_confirmation: "#fd7e14",
        waitlisted: "#0dcaf0",
        cancelled: "#dc3545",
      };

      const regTotal = s.registrations.total;
      const confirmed = s.registrations.byStatus.registered ?? 0;
      const waitlisted = s.registrations.byStatus.waitlisted ?? 0;
      const attendeePending = s.invites.attendee.byStatus.sent ?? 0;
      const attendeeAccepted = s.invites.attendee.byStatus.accepted ?? 0;
      const attendeeDeclined = s.invites.attendee.byStatus.declined ?? 0;
      const speakerPending = s.invites.speaker.byStatus.sent ?? 0;
      const speakerAccepted = s.invites.speaker.byStatus.accepted ?? 0;

      const rawGrowthDates = [...new Set(s.registrations.growthByDay.map((r) => r.date))].sort();
      const growthDates = rawGrowthDates.length > 1
        ? isoDateRange(rawGrowthDates[0], rawGrowthDates[rawGrowthDates.length - 1])
        : rawGrowthDates;
      const allAttTypes = [...new Set(s.registrations.growthByDay.map((r) => r.attendance_type))];
      const growthByDayIndex: Record<string, Record<string, number>> = {};
      for (const r of s.registrations.growthByDay) {
        growthByDayIndex[r.date] ??= {};
        growthByDayIndex[r.date][r.attendance_type] = (growthByDayIndex[r.date][r.attendance_type] ?? 0) + r.count;
      }
      const growthSeries = allAttTypes.map((at) => ({
        label: attLabels[at] ?? at,
        color: attColors[at] ?? "#6c757d",
        values: growthDates.map((d) => growthByDayIndex[d]?.[at] ?? 0),
      }));
      const growthChartHtml = growthDates.length > 0
        ? svgStackedBarChart(growthDates.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`), growthSeries, { isoLabels: growthDates })
        : '<p class="text-muted fst-italic small">No registrations yet.</p>';

      const dayLabels = [...new Set(s.registrationsByEventDay.map((r) => r.label ?? r.day_date))];
      const dayAttTypes = [...new Set(s.registrationsByEventDay.map((r) => r.attendance_type))];
      const attLightColors: Record<string, string> = { in_person: "#9ec5fe", virtual: "#a3cfbb", on_demand: "#fed8b1" };
      const dayStatusIndex: Record<string, Record<string, { confirmed: number; pending: number }>> = {};
      for (const r of s.registrationsByEventDay) {
        const lbl = r.label ?? r.day_date;
        dayStatusIndex[lbl] ??= {};
        dayStatusIndex[lbl][r.attendance_type] ??= { confirmed: 0, pending: 0 };
        if (r.status === "registered") {
          dayStatusIndex[lbl][r.attendance_type].confirmed += r.count;
        } else {
          dayStatusIndex[lbl][r.attendance_type].pending += r.count;
        }
      }
      const daySeries = dayAttTypes
        .flatMap((at) => [
          {
            label: `${attLabels[at] ?? at} – Confirmed`,
            color: attColors[at] ?? "#6c757d",
            values: dayLabels.map((lbl) => dayStatusIndex[lbl]?.[at]?.confirmed ?? 0),
          },
          {
            label: `${attLabels[at] ?? at} – Pending`,
            color: attLightColors[at] ?? "#ced4da",
            values: dayLabels.map((lbl) => dayStatusIndex[lbl]?.[at]?.pending ?? 0),
          },
        ])
        .filter((sr) => sr.values.some((v) => v > 0));
      const dayChartHtml = dayLabels.length > 0
        ? svgStackedBarChart(dayLabels, daySeries)
        : '<p class="text-muted fst-italic small">No per-day attendance data yet.</p>';
      const dayTableRows = dayLabels.flatMap((lbl) =>
        dayAttTypes.map((at) => {
          const conf = dayStatusIndex[lbl]?.[at]?.confirmed ?? 0;
          const pend = dayStatusIndex[lbl]?.[at]?.pending ?? 0;
          if (!conf && !pend) return "";
          return (
            `<tr>` +
            `<td>${esc(lbl)}</td>` +
            `<td class="small">${esc(attLabels[at] ?? at)}</td>` +
            `<td class="mono text-success text-end">${conf > 0 ? conf : "—"}</td>` +
            `<td class="mono text-secondary text-end">${pend > 0 ? pend : "—"}</td>` +
            `<td class="mono fw-semibold text-end">${conf + pend}</td>` +
            `</tr>`
          );
        }),
      ).filter(Boolean);
      const dayBlockHtml = dayLabels.length > 0
        ? '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-2">Registrations by Event Day</h6>' +
          '<div class="text-muted small mb-2">Stacked by attendance type · <span class="text-success fw-semibold">solid = confirmed</span>, <span class="text-secondary fw-semibold">light = pending/waitlisted</span>.</div>' +
          dayChartHtml +
          (dayTableRows.length > 0 ? '<div class="mt-3">' + tbl(["Day", "Type", "Confirmed", "Pending", "Total"], dayTableRows, "No data") + '</div>' : "") +
          '</div></div>'
        : "";

      const crossStatuses = [...new Set(s.registrations.byStatusAndType.map((r) => r.status))];
      const crossAttTypes = [...new Set(s.registrations.byStatusAndType.map((r) => r.attendance_type))];
      const crossIndex: Record<string, Record<string, number>> = {};
      for (const r of s.registrations.byStatusAndType) {
        crossIndex[r.status] ??= {};
        crossIndex[r.status][r.attendance_type] = r.count;
      }
      const crossHeaderCols = crossAttTypes.map((at) => `<th class="text-end small">${esc(attLabels[at] ?? at)}</th>`).join("") + '<th class="text-end small">Total</th>';
      const crossTableRows = crossStatuses.map((st) => {
        const rowTotal = crossAttTypes.reduce((sum, at) => sum + (crossIndex[st]?.[at] ?? 0), 0);
        const cells = crossAttTypes.map((at) => `<td class="text-end mono">${crossIndex[st]?.[at] ?? 0}</td>`).join("");
        return `<tr><td>${badge(st)}</td>${cells}<td class="text-end mono fw-semibold">${rowTotal}</td></tr>`;
      });
      const crossTotalsRow = `<tr class="table-light fw-semibold"><td class="small">Total</td>${crossAttTypes.map((at) => {
        const col = crossStatuses.reduce((sum, st) => sum + (crossIndex[st]?.[at] ?? 0), 0);
        return `<td class="text-end mono">${col}</td>`;
      }).join("")}<td class="text-end mono">${regTotal}</td></tr>`;

      const crossTableHtml = crossStatuses.length > 0
        ? `<div class="tbl-wrap"><table class="table table-sm align-middle mb-0"><thead class="table-light"><tr><th class="small">Status</th>${crossHeaderCols}</tr></thead><tbody>${crossTableRows.join("")}</tbody><tfoot>${crossTotalsRow}</tfoot></table></div>`
        : '<p class="text-muted fst-italic small">No data</p>';

      const statusSeries = crossStatuses.map((st) => ({
        label: st,
        color: statusColors[st] ?? "#6c757d",
        values: crossAttTypes.map((at) => crossIndex[st]?.[at] ?? 0),
      }));
      const statusStackHtml = crossStatuses.length > 0
        ? svgStackedBarChart(crossAttTypes.map((at) => attLabels[at] ?? at), statusSeries)
        : "";

      const declineTable = (
        title: string,
        reasons: Array<{ reason_code: string | null; count: number; unsubscribed: number }>,
      ): string => {
        if (!reasons.length) return '<p class="text-muted fst-italic small">No declines recorded.</p>';
        const total = reasons.reduce((sum, r) => sum + r.count, 0);
        const rows = reasons.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            `<tr>` +
            `<td class="small">${r.reason_code ? esc(r.reason_code) : '<span class="text-muted fst-italic">not given</span>'}</td>` +
            `<td class="mono">${r.count}</td>` +
            `<td class="text-muted small">${pct}%</td>` +
            `<td class="mono small text-warning">${r.unsubscribed > 0 ? r.unsubscribed : "—"}</td>` +
            `</tr>`
          );
        });
        return tbl([title, "Declined", "%", "Unsub'd"], rows, "No data");
      };

      const actionLabel: Record<string, string> = {
        cancelled: "Cancelled",
        downgraded_virtual: "Downgraded → Virtual",
        downgraded_on_demand: "Downgraded → On demand",
      };
      const rsvpStatusRows = Object.entries(s.rsvp.byStatus).map(
        ([k, v]) => `<tr><td>${badge(k)}</td><td class="mono">${v}</td><td class="text-muted small">${s.rsvp.total > 0 ? Math.round((v / s.rsvp.total) * 100) : 0}%</td></tr>`,
      );
      const rsvpProviderRows = Object.entries(s.rsvp.byProvider).map(([k, v]) => `<tr><td class="small">${esc(k)}</td><td class="mono">${v}</td></tr>`);
      const rsvpActionRows = Object.entries(s.rsvp.actionsTaken).map(
        ([k, v]) => `<tr><td class="small">${esc(actionLabel[k] ?? k)}</td><td class="mono">${v}</td></tr>`,
      );
      const rsvpTabHtml =
        s.rsvp.total === 0
          ? '<p class="text-muted fst-italic">No calendar reply emails received yet.</p>'
          : '<div class="row g-3">' +
              `<div class="col-sm-4">${sc("Calendar Replies", s.rsvp.total, `${s.rsvp.byStatus.accepted ?? 0} accepted · ${s.rsvp.byStatus.declined ?? 0} declined`)}</div>` +
              `<div class="col-sm-4">${sc("Actions Taken", Object.values(s.rsvp.actionsTaken).reduce((sum, value) => sum + value, 0), "Automated pipeline actions")}</div>` +
              `<div class="col-sm-4">${sc("Providers", Object.keys(s.rsvp.byProvider).length, "Distinct calendar clients")}</div>` +
            '</div>' +
            '<div class="row g-3 mt-1">' +
              '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
                '<h6 class="text-uppercase small fw-bold text-muted mb-3">Response Status</h6>' +
                tbl(["Status", "Count", "%"], rsvpStatusRows, "No replies") +
              '</div></div></div>' +
              '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
                '<h6 class="text-uppercase small fw-bold text-muted mb-3">Calendar Providers</h6>' +
                tbl(["Provider", "Count"], rsvpProviderRows, "No data") +
              '</div></div></div>' +
            '</div>' +
            (rsvpActionRows.length > 0
              ? '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
                '<h6 class="text-uppercase small fw-bold text-muted mb-3">Automated Actions Taken</h6>' +
                '<p class="text-muted small">Actions executed by the RSVP pipeline in response to declined / bounced calendar replies.</p>' +
                tbl(["Action", "Count"], rsvpActionRows, "No actions") +
                '</div></div>'
              : '');

      const tabContent = {
        overview:
          '<div class="row g-3">' +
            `<div class="col-sm-4">${sc("Total Registrations", regTotal, `${confirmed} confirmed · ${waitlisted} waitlisted`)}</div>` +
            `<div class="col-sm-4">${sc("Attendee Invites", s.invites.attendee.total, `${attendeeAccepted} accepted · ${attendeePending} pending · ${attendeeDeclined} declined`)}</div>` +
            `<div class="col-sm-4">${sc("Speaker Invites / Proposals", s.invites.speaker.total + s.proposals.total, `${speakerAccepted} accepted · ${speakerPending} pending`)}</div>` +
          '</div>' +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registration Status</h6>' +
            svgStatusSegmentBar(s.registrations.byStatus, regTotal) +
          '</div></div>' +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-2">Registration Growth — all time, by attendance type</h6>' +
            '<div class="text-muted small mb-2">Stacked by attendance type per day since first registration.</div>' +
            growthChartHtml +
          '</div></div>',

        registrations:
          '<div class="card border-0 shadow-sm"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Status × Attendance Type</h6>' +
            statusStackHtml +
            '<div class="mt-3">' + crossTableHtml + '</div>' +
          '</div></div>' +
          (dayLabels.length > 0
            ? '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-2">Registrations by Event Day</h6>' +
              '<div class="text-muted small mb-2">Confirmed registrations per event day, stacked by attendance type.</div>' +
              dayChartHtml +
              (dayTableRows.length > 0 ? '<div class="mt-3">' + tbl(["Day", "Type", "Confirmed", "Pending", "Total"], dayTableRows, "No data") + '</div>' : "") +
              '</div></div>'
            : ""),

        invites:
          '<div class="row g-3">' +
            '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-3">Attendee Invites</h6>' +
              tbl(["Status", "Count"], Object.entries(s.invites.attendee.byStatus).map(([k, v]) => `<tr><td>${inviteBadge(k)}</td><td class="mono">${v}</td></tr>`), "None") +
              `<div class="mt-2 small text-muted">Total: <strong>${s.invites.attendee.total}</strong></div>` +
              '<hr class="my-3">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-2">Decline Reasons — Attendees</h6>' +
              declineTable("Reason", s.invites.attendee.declineReasons) +
            '</div></div></div>' +
            '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-3">Speaker Invites</h6>' +
              tbl(["Status", "Count"], Object.entries(s.invites.speaker.byStatus).map(([k, v]) => `<tr><td>${inviteBadge(k)}</td><td class="mono">${v}</td></tr>`), "None") +
              `<div class="mt-2 small text-muted">Total: <strong>${s.invites.speaker.total}</strong></div>` +
              '<hr class="my-3">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-2">Decline Reasons — Speakers</h6>' +
              declineTable("Reason", s.invites.speaker.declineReasons) +
            '</div></div></div>' +
          '</div>' +
          (s.proposals.total > 0
            ? '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-3">Proposals</h6>' +
              tbl(["Status", "Count"], Object.entries(s.proposals.byStatus).map(([k, v]) => `<tr><td>${badge(k)}</td><td class="mono">${v}</td></tr>`), "None") +
              `<div class="mt-2 small text-muted">Total: <strong>${s.proposals.total}</strong></div>` +
              '</div></div>'
            : ""),

        rsvp: rsvpTabHtml,
      };

      const tabKeys = ["overview", "registrations", "invites", "rsvp"] as const;
      const tabLabels: Record<string, string> = { overview: "Overview", registrations: "Registrations", invites: "Invites & Proposals", rsvp: "Calendar RSVPs" };

      body.innerHTML =
        '<ul class="nav nav-tabs mb-3" id="event-stats-tabs">' +
          tabKeys.map((k, i) => `<li class="nav-item"><button class="nav-link${i === 0 ? " active" : ""}" data-event-stats-tab="${k}">${tabLabels[k]}</button></li>`).join("") +
        '</ul>' +
        `<div id="event-stats-tab-content">${tabContent.overview}</div>`;

      body.querySelector("#event-stats-tabs")?.addEventListener("click", (evt) => {
        const btn = (evt.target as Element).closest<HTMLButtonElement>("[data-event-stats-tab]");
        if (!btn) return;
        const tab = btn.dataset.eventStatsTab as keyof typeof tabContent;
        body.querySelectorAll<HTMLButtonElement>("[data-event-stats-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const content = body.querySelector("#event-stats-tab-content");
        if (content) content.innerHTML = tabContent[tab] ?? "";
      });
    } catch (err) {
      body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  };

  if (refreshBtn && !refreshBtn.dataset.wired) {
    refreshBtn.dataset.wired = "1";
    refreshBtn.addEventListener("click", () => void doLoad());
  }

  await doLoad();
}
