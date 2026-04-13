import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { fmtMoney, svgBarChart, svgLineChart } from "../charts";
import type { StatsResponse, DonationPeriod } from "../types";
import { useData } from "../../hooks/useData";

type StatsTab = "overview" | "registrations" | "donations";

const ATTENDANCE_LABELS: Record<string, string> = {
  in_person: "In person",
  virtual: "Virtual",
  on_demand: "On demand",
};

export function Stats() {
  const { data: stats, loading, error } = useData<StatsResponse>(
    () => api<StatsResponse>("/api/v1/admin/stats"), [],
  );
  const [tab, setTab] = useState<StatsTab>("overview");

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!stats) return null;

  const TABS: Array<{ key: StatsTab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "registrations", label: "Registrations" },
    { key: "donations", label: "Donations" },
  ];

  return (
    <div>
      <ul class="nav nav-tabs mb-3">
        {TABS.map(({ key, label }) => (
          <li key={key} class="nav-item">
            <button
              class={`nav-link${tab === key ? " active" : ""}`}
              type="button"
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>

      {tab === "overview" && <OverviewTab stats={stats} />}
      {tab === "registrations" && <RegistrationsTab stats={stats} />}
      {tab === "donations" && <DonationsTab stats={stats} />}
    </div>
  );
}

function OverviewTab({ stats }: { stats: StatsResponse }) {
  const activityChart = svgLineChart(
    [
      { label: "Registrations", values: stats.recentActivity.map((d) => d.registrations), stroke: "#198754", area: "rgba(25,135,84,.07)" },
      { label: "Invites", values: stats.recentActivity.map((d) => d.invites), stroke: "#fd7e14", area: "rgba(253,126,20,.07)" },
    ],
    stats.recentActivity.map((d) => d.date.slice(5)),
  );

  return (
    <div>
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card border-0 shadow-sm">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations</h6>
              <StatusTable entries={Object.entries(stats.registrations.byStatus)} />
              <h6 class="text-uppercase small fw-bold text-muted mb-3 mt-3">By Attendance Type</h6>
              <SimpleTable
                rows={Object.entries(stats.registrations.byAttendanceType ?? {}).map(([k, v]) => [ATTENDANCE_LABELS[k] ?? k, String(v)])}
              />
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card border-0 shadow-sm">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">Invites</h6>
              <StatusTable entries={Object.entries(stats.invites.byStatus)} />
            </div>
          </div>
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Activity — last 30 days</h6>
          <div dangerouslySetInnerHTML={{ __html: activityChart }} />
        </div>
      </div>
    </div>
  );
}

function RegistrationsTab({ stats }: { stats: StatsResponse }) {
  const r = stats.registrations;
  const weeklyChart = svgBarChart(r.weekly.map((d) => d.week.slice(5)), r.weekly.map((d) => d.count));
  const monthlyChart = svgBarChart(r.monthly.map((d) => d.month.slice(0, 7)), r.monthly.map((d) => d.count));

  return (
    <div>
      <div class="card border-0 shadow-sm">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">By Attendance Type</h6>
          <SimpleTable rows={Object.entries(r.byAttendanceType ?? {}).map(([k, v]) => [ATTENDANCE_LABELS[k] ?? k, String(v)])} />
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Weekly (last 12 weeks)</h6>
          <div dangerouslySetInnerHTML={{ __html: weeklyChart }} />
          <SimpleTable rows={r.weekly.map((d) => [d.week, String(d.count)])} heads={["Week", "Count"]} />
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Monthly (last 12 months)</h6>
          <div dangerouslySetInnerHTML={{ __html: monthlyChart }} />
          <SimpleTable rows={r.monthly.map((d) => [d.month, String(d.count)])} heads={["Month", "Count"]} />
        </div>
      </div>
    </div>
  );
}

function DonationsTab({ stats }: { stats: StatsResponse }) {
  const don = stats.donations;
  const primaryCurrency = don.byCurrency.find((r) => r.status === "completed")?.currency ?? "usd";
  const monthlyChart = svgBarChart(
    don.monthly.map((d) => d.month.slice(0, 7)),
    don.monthly.map((d) => d.completed),
    { color: "#0d6efd" },
  );

  function periodLabel(d: DonationPeriod & { date?: string; week?: string; month?: string }): string {
    return d.date ?? d.week ?? d.month ?? "";
  }

  function PeriodRows({ rows }: { rows: Array<DonationPeriod & { date?: string; week?: string; month?: string }> }) {
    return (
      <>
        {rows.map((d, i) => (
          <tr key={i}>
            <td class="mono">{periodLabel(d)}</td>
            <td>{d.count}</td>
            <td>{d.completed}</td>
            <td>{d.pending}</td>
            <td>{d.failed}</td>
            <td>{d.expired}</td>
            <td class="mono">{d.gross > 0 ? fmtMoney(d.gross, primaryCurrency) : "—"}</td>
          </tr>
        ))}
      </>
    );
  }

  const periodHeads = ["Period", "Total", "Compl.", "Pend.", "Failed", "Expd.", `Gross (${primaryCurrency.toUpperCase()})`];

  return (
    <div>
      <div class="card border-0 shadow-sm">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations by Status &amp; Currency</h6>
          <div class="table-responsive">
            <table class="table table-sm">
              <thead><tr><th>Status</th><th>Currency</th><th>Count</th><th>Gross</th><th>Avg Gross</th><th>Net Total</th></tr></thead>
              <tbody>
                {don.byCurrency.length === 0 ? (
                  <tr><td colSpan={6} class="text-center text-muted fst-italic">No donations</td></tr>
                ) : don.byCurrency.map((d, i) => (
                  <tr key={i}>
                    <td><Badge status={d.status} /></td>
                    <td class="mono">{d.currency.toUpperCase()}</td>
                    <td>{d.count}</td>
                    <td class="mono">{fmtMoney(d.total_gross, d.currency)}</td>
                    <td class="mono">{fmtMoney(d.avg_gross, d.currency)}</td>
                    <td class="mono">{d.total_net != null ? fmtMoney(d.total_net, d.currency) : `— (${d.status})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Daily (last 30 days)</h6>
          <div class="table-responsive">
            <table class="table table-sm">
              <thead><tr>{periodHeads.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody><PeriodRows rows={don.daily} /></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Weekly (last 12 weeks)</h6>
          <div class="table-responsive">
            <table class="table table-sm">
              <thead><tr>{periodHeads.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody><PeriodRows rows={don.weekly} /></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Monthly (last 12 months)</h6>
          <div dangerouslySetInnerHTML={{ __html: monthlyChart }} />
          <div class="table-responsive">
            <table class="table table-sm">
              <thead><tr>{periodHeads.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody><PeriodRows rows={don.monthly} /></tbody>
            </table>
          </div>
        </div>
      </div>
      <details class="card border-0 shadow-sm mt-3">
        <summary class="card-body text-muted small adm-summary-toggle">JSON export (for automated reporting)</summary>
        <div class="card-body pt-0">
          <pre class="json-out">{JSON.stringify(stats, null, 2)}</pre>
        </div>
      </details>
    </div>
  );
}

// ── Shared table helpers ──────────────────────────────────────────────────────

function StatusTable({ entries }: { entries: Array<[string, number]> }) {
  return (
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          {entries.length === 0 ? (
            <tr><td colSpan={2} class="text-center text-muted fst-italic">None</td></tr>
          ) : entries.map(([k, v]) => (
            <tr key={k}><td><Badge status={k} /></td><td class="mono">{v}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ rows, heads = ["Item", "Count"] }: { rows: Array<[string, string]>; heads?: [string, string] }) {
  return (
    <div class="table-responsive">
      <table class="table table-sm">
        <thead><tr><th>{heads[0]}</th><th>{heads[1]}</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={2} class="text-center text-muted fst-italic">No data</td></tr>
          ) : rows.map(([label, value], i) => (
            <tr key={i}><td>{label}</td><td class="mono">{value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
