import { badge, esc, q, spinner, tbl } from "./ui";
import { fmtMoney, statusBars, svgBarChart, svgLineChart } from "./charts";

export interface DonationPeriod {
  count: number;
  completed: number;
  pending: number;
  failed: number;
  expired: number;
  gross: number;
}

export interface StatsResponse {
  registrations: {
    byStatus: Record<string, number>;
    byAttendanceType: Record<string, number>;
    total: number;
    weekly: Array<{ week: string; count: number }>;
    monthly: Array<{ month: string; count: number }>;
  };
  invites: { byStatus: Record<string, number>; total: number };
  email: { outboxByStatus: Record<string, number>; totalQueued: number; totalFailed: number };
  topEvents: Array<{ slug: string; name: string; confirmed: number; total: number }>;
  recentActivity: Array<{ date: string; registrations: number; invites: number }>;
  donations: {
    byStatus: Record<string, number>;
    byCurrency: Array<{ status: string; currency: string; count: number; total_gross: number; avg_gross: number; total_net: number | null }>;
    daily: Array<{ date: string } & DonationPeriod>;
    weekly: Array<{ week: string } & DonationPeriod>;
    monthly: Array<{ month: string } & DonationPeriod>;
  };
}

interface ReportsSectionDeps {
  api<T = unknown>(path: string, opts?: RequestInit & { headers?: Record<string, string> }): Promise<T>;
  goToSection(section: string): void;
  openEvent(slug: string): Promise<void>;
}

function statCard(label: string, value: number, note: string, variant = ""): string {
  const cls = variant === "danger" && value > 0 ? " danger" : "";
  return (
    `<div class="stat-card${cls}">` +
    `<div class="val">${value}</div>` +
    `<div class="lbl">${esc(label)}</div>` +
    `<div class="note">${esc(note)}</div></div>`
  );
}

function attendanceLabel(value: string): string {
  const labels: Record<string, string> = { in_person: "In person", virtual: "Virtual", on_demand: "On demand" };
  return labels[value] ?? value;
}

export function createReportsSection(deps: ReportsSectionDeps): {
  loadDashboard: () => Promise<void>;
  loadStats: () => Promise<void>;
} {
  const { api, goToSection, openEvent } = deps;

  async function loadDashboard(): Promise<void> {
    const el = q("#d-body");
    if (!el) return;
    el.innerHTML = spinner();
    try {
      const s = await api<StatsResponse>("/api/v1/admin/stats");
      const { registrations: r, email: em, invites: inv, donations: don } = s;
      const donTop = don.byCurrency.find((d) => d.status === "completed");
      const donCompleted = don.byStatus.completed ?? 0;
      const donPending = don.byStatus.pending ?? 0;
      const donFailed = don.byStatus.failed ?? 0;
      const donExpired = don.byStatus.expired ?? 0;
      el.innerHTML =
        '<div class="stat-grid">' +
          statCard("Total Registrations", r.total, `${r.byStatus.registered ?? 0} confirmed`) +
          statCard("Pending Invites", inv.byStatus.sent ?? 0, `${inv.total} total`) +
          statCard("Queued Emails", em.totalQueued, "") +
          statCard("Failed Emails", em.totalFailed, "go to Email tab to fix", em.totalFailed > 0 ? "danger" : "") +
          statCard("Completed Donations", donCompleted, donTop ? `${fmtMoney(donTop.total_gross, donTop.currency)} total` : "no data") +
          statCard("Pending Donations", donPending, [donFailed > 0 ? `${donFailed} failed` : "", donExpired > 0 ? `${donExpired} expired` : ""].filter(Boolean).join(" · ") || "none failed", donFailed > 0 ? "danger" : "") +
        "</div>" +
        '<div class="row g-3">' +
          '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations by Status</h6>' +
            statusBars(r.byStatus, r.total) +
          "</div></div></div>" +
          '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Top Events</h6>' +
            tbl(
              ["Event", "Conf.", "Total"],
              s.topEvents.map(
                (e) =>
                  `<tr><td><button class="btn btn-link p-0 small text-start" data-nav-event="${esc(e.slug)}">${esc(e.name)}</button></td>` +
                  `<td>${e.confirmed}</td><td>${e.total}</td></tr>`,
              ),
              "No events",
            ) +
          "</div></div></div>" +
        "</div>" +
        '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
          '<h6 class="text-uppercase small fw-bold text-muted mb-3">Activity — last 30 days</h6>' +
          svgLineChart(
            [
              { label: "Registrations", values: s.recentActivity.map((d) => d.registrations), stroke: "#198754", area: "rgba(25,135,84,.07)" },
              { label: "Invites", values: s.recentActivity.map((d) => d.invites), stroke: "#fd7e14", area: "rgba(253,126,20,.07)" },
            ],
            s.recentActivity.map((d) => d.date.slice(5)),
          ) +
        "</div></div>";

      el.querySelectorAll<HTMLButtonElement>("[data-nav-event]").forEach((btn) => {
        btn.addEventListener("click", () => {
          goToSection("events");
          const slug = btn.dataset.navEvent!;
          setTimeout(() => void openEvent(slug), 200);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  async function loadStats(): Promise<void> {
    const el = q("#r-body");
    if (!el) return;
    el.innerHTML = spinner();
    try {
      const s = await api<StatsResponse>("/api/v1/admin/stats");
      const primaryCurrency = s.donations.byCurrency.find((r) => r.status === "completed")?.currency ?? "usd";

      const donationPeriodRows = (rows: Array<{ gross: number } & DonationPeriod>, keyVal: (r: DonationPeriod & { gross: number }) => string) =>
        rows.map((d) =>
          `<tr><td class="mono">${esc(keyVal(d))}</td><td>${d.count}</td><td>${d.completed}</td>` +
          `<td>${d.pending}</td><td>${d.failed}</td><td>${d.expired}</td>` +
          `<td class="mono">${d.gross > 0 ? fmtMoney(d.gross, primaryCurrency) : "—"}</td></tr>`,
        );

      const tabContent = {
        overview:
          '<div class="row g-3">' +
            '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations</h6>' +
              tbl(
                ["Status", "Count"],
                Object.entries(s.registrations.byStatus).map(([k, v]) => `<tr><td>${badge(k)}</td><td class="mono">${v}</td></tr>`),
                "None",
              ) +
              '<h6 class="text-uppercase small fw-bold text-muted mb-3 mt-3">By Attendance Type</h6>' +
              tbl(
                ["Attendance Type", "Count"],
                Object.entries(s.registrations.byAttendanceType ?? {}).map(([k, v]) => `<tr><td>${esc(attendanceLabel(k))}</td><td class="mono">${v}</td></tr>`),
                "None",
              ) +
            "</div></div></div>" +
            '<div class="col-md-6"><div class="card border-0 shadow-sm"><div class="card-body">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-3">Invites</h6>' +
              tbl(
                ["Status", "Count"],
                Object.entries(s.invites.byStatus).map(([k, v]) => `<tr><td>${badge(k)}</td><td class="mono">${v}</td></tr>`),
                "None",
              ) +
            "</div></div></div>" +
          "</div>" +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Activity — last 30 days</h6>' +
            svgLineChart(
              [
                { label: "Registrations", values: s.recentActivity.map((d) => d.registrations), stroke: "#198754", area: "rgba(25,135,84,.07)" },
                { label: "Invites", values: s.recentActivity.map((d) => d.invites), stroke: "#fd7e14", area: "rgba(253,126,20,.07)" },
              ],
              s.recentActivity.map((d) => d.date.slice(5)),
            ) +
          "</div></div>",

        registrations:
          '<div class="card border-0 shadow-sm"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations by Attendance Type</h6>' +
            tbl(
              ["Attendance Type", "Count"],
              Object.entries(s.registrations.byAttendanceType ?? {}).map(([k, v]) => `<tr><td>${esc(attendanceLabel(k))}</td><td class="mono">${v}</td></tr>`),
              "No data",
            ) +
          "</div></div>" +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Weekly (last 12 weeks)</h6>' +
            svgBarChart(s.registrations.weekly.map((d) => d.week.slice(5)), s.registrations.weekly.map((d) => d.count)) +
            tbl(
              ["Week", "Count"],
              s.registrations.weekly.map((d) => `<tr><td class="mono">${esc(d.week)}</td><td>${d.count}</td></tr>`),
              "No data",
            ) +
          "</div></div>" +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Monthly (last 12 months)</h6>' +
            svgBarChart(s.registrations.monthly.map((d) => d.month.slice(0, 7)), s.registrations.monthly.map((d) => d.count)) +
            tbl(
              ["Month", "Count"],
              s.registrations.monthly.map((d) => `<tr><td class="mono">${esc(d.month)}</td><td>${d.count}</td></tr>`),
              "No data",
            ) +
          "</div></div>",

        donations:
          '<div class="card border-0 shadow-sm"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations by Status &amp; Currency</h6>' +
            tbl(
              ["Status", "Currency", "Count", "Gross", "Avg Gross", "Net Total"],
              s.donations.byCurrency.map((d) =>
                `<tr><td>${badge(d.status)}</td>` +
                `<td class="mono">${esc(d.currency.toUpperCase())}</td>` +
                `<td>${d.count}</td>` +
                `<td class="mono">${fmtMoney(d.total_gross, d.currency)}</td>` +
                `<td class="mono">${fmtMoney(d.avg_gross, d.currency)}</td>` +
                `<td class="mono">${d.total_net != null ? fmtMoney(d.total_net, d.currency) : "— <span class=\"text-muted small\">(" + esc(d.status) + ")</span>"}</td></tr>`,
              ),
              "No donations",
            ) +
          "</div></div>" +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Daily (last 30 days)</h6>' +
            tbl(
              ["Date", "Total", "Compl.", "Pend.", "Failed", "Expd.", `Gross (${primaryCurrency.toUpperCase()})`],
              donationPeriodRows(s.donations.daily, (d) => (d as { date: string } & DonationPeriod).date),
              "No data",
            ) +
          "</div></div>" +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Weekly (last 12 weeks)</h6>' +
            tbl(
              ["Week", "Total", "Compl.", "Pend.", "Failed", "Expd.", `Gross (${primaryCurrency.toUpperCase()})`],
              donationPeriodRows(s.donations.weekly, (d) => (d as { week: string } & DonationPeriod).week),
              "No data",
            ) +
          "</div></div>" +
          '<div class="card border-0 shadow-sm mt-3"><div class="card-body">' +
            '<h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Monthly (last 12 months)</h6>' +
            svgBarChart(s.donations.monthly.map((d) => d.month.slice(0, 7)), s.donations.monthly.map((d) => d.completed), { color: "#0d6efd" }) +
            tbl(
              ["Month", "Total", "Compl.", "Pend.", "Failed", "Expd.", `Gross (${primaryCurrency.toUpperCase()})`],
              donationPeriodRows(s.donations.monthly, (d) => (d as { month: string } & DonationPeriod).month),
              "No data",
            ) +
          "</div></div>" +
          '<details class="card border-0 shadow-sm mt-3">' +
            '<summary class="card-body text-muted small adm-summary-toggle">JSON export (for automated reporting)</summary>' +
            `<div class="card-body pt-0"><pre class="json-out">${esc(JSON.stringify(s, null, 2))}</pre></div>` +
          "</details>",
      };

      el.innerHTML =
        '<ul class="nav nav-tabs mb-3" id="stats-tabs" role="tablist">' +
          '<li class="nav-item" role="presentation"><button class="nav-link active" data-stats-tab="overview">Overview</button></li>' +
          '<li class="nav-item" role="presentation"><button class="nav-link" data-stats-tab="registrations">Registrations</button></li>' +
          '<li class="nav-item" role="presentation"><button class="nav-link" data-stats-tab="donations">Donations</button></li>' +
        "</ul>" +
        `<div id="stats-tab-content">${tabContent.overview}</div>`;

      el.querySelector("#stats-tabs")?.addEventListener("click", (evt) => {
        const btn = (evt.target as Element).closest<HTMLButtonElement>("[data-stats-tab]");
        if (!btn) return;
        const tab = btn.dataset.statsTab as keyof typeof tabContent;
        el.querySelectorAll<HTMLButtonElement>("[data-stats-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const content = el.querySelector("#stats-tab-content");
        if (content) content.innerHTML = tabContent[tab] ?? "";
      });
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  return { loadDashboard, loadStats };
}
