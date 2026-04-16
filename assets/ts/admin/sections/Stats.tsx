import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { DataTable, type Column } from "../../components/Table";
import { Tabs } from "../../components/Tabs";
import { api } from "../api";
import { fmtMoney, svgBarChart, svgLineChart, svgStackedBarChart } from "../charts";
import type { StatsResponse, DonationPeriod } from "../types";
import { useData } from "../../hooks/useData";

type StatsTab = "overview" | "registrations" | "donations";

const ATTENDANCE_LABELS: Record<string, string> = {
  in_person: "In person",
  virtual: "Virtual",
  on_demand: "On demand",
};

export function Stats({ subTab }: { subTab?: string }) {
  const { data: stats, loading, error } = useData<StatsResponse>(() => api<StatsResponse>("/api/v1/admin/stats"), []);
  const [, navigate] = useHashLocation();
  const tab: StatsTab = subTab === "registrations" || subTab === "donations" ? subTab : "overview";

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
      <Tabs items={TABS} active={tab} onChange={(key) => navigate(key === "overview" ? "/stats" : `/stats/${key}`)} />

      {tab === "overview" && <OverviewTab stats={stats} />}
      {tab === "registrations" && <RegistrationsTab stats={stats} />}
      {tab === "donations" && <DonationsTab stats={stats} />}
    </div>
  );
}

function OverviewTab({ stats }: { stats: StatsResponse }) {
  const activityChart = svgLineChart(
    [
      {
        label: "Registrations",
        values: stats.recentActivity.map((d) => d.registrations),
        stroke: "#198754",
        area: "rgba(25,135,84,.07)",
      },
      {
        label: "Invites",
        values: stats.recentActivity.map((d) => d.invites),
        stroke: "#fd7e14",
        area: "rgba(253,126,20,.07)",
      },
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
                rows={Object.entries(stats.registrations.byAttendanceType ?? {}).map(([k, v]) => [
                  ATTENDANCE_LABELS[k] ?? k,
                  String(v),
                ])}
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
  const weeklyChart = svgBarChart(
    r.weekly.map((d) => d.week.slice(5)),
    r.weekly.map((d) => d.count),
  );
  const monthlyChart = svgBarChart(
    r.monthly.map((d) => d.month.slice(0, 7)),
    r.monthly.map((d) => d.count),
  );

  return (
    <div>
      <div class="card border-0 shadow-sm">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">By Attendance Type</h6>
          <SimpleTable
            rows={Object.entries(r.byAttendanceType ?? {}).map(([k, v]) => [ATTENDANCE_LABELS[k] ?? k, String(v)])}
          />
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

  function amountChart(labels: string[], periods: Array<DonationPeriod>): string {
    const grossValues = periods.map((d) => d.gross_usd);
    const feeValues = periods.map((d) => Math.max(0, d.gross_usd - d.net_usd));
    const hasData = grossValues.some((v) => v > 0);
    if (!hasData) return "";
    return svgStackedBarChart(
      labels,
      [
        { label: "Net (USD)", values: periods.map((d) => d.net_usd), color: "#198754" },
        { label: "Fees", values: feeValues, color: "#dee2e6" },
      ],
      { valueFormatter: (v) => fmtMoney(v, "usd") },
    );
  }

  const monthlyCountChart = svgBarChart(
    don.monthly.map((d) => d.month.slice(0, 7)),
    don.monthly.map((d) => d.completed),
    { color: "#0d6efd" },
  );
  const monthlyAmountChart = amountChart(
    don.monthly.map((d) => d.month.slice(0, 7)),
    don.monthly,
  );
  const weeklyAmountChart = amountChart(
    don.weekly.map((d) => d.week),
    don.weekly,
  );
  const dailyAmountChart = amountChart(
    don.daily.map((d) => d.date.slice(5)),
    don.daily,
  );

  function periodLabel(d: DonationPeriod & { date?: string; week?: string; month?: string }): string {
    return d.date ?? d.week ?? d.month ?? "";
  }

  const periodColumns: Column<DonationPeriod & { date?: string; week?: string; month?: string }>[] = [
    { header: "Period", cell: (d) => periodLabel(d), className: "mono" },
    { header: { label: "Total", className: "text-end" }, cell: (d) => d.count, className: "mono text-end" },
    { header: { label: "Compl.", className: "text-end" }, cell: (d) => d.completed, className: "mono text-end" },
    { header: { label: "Pend.", className: "text-end" }, cell: (d) => d.pending, className: "mono text-end" },
    { header: { label: "Failed", className: "text-end" }, cell: (d) => d.failed, className: "mono text-end" },
    { header: { label: "Expd.", className: "text-end" }, cell: (d) => d.expired, className: "mono text-end" },
    {
      header: { label: `Gross (${primaryCurrency.toUpperCase()})`, className: "text-end" },
      cell: (d) => (d.gross > 0 ? fmtMoney(d.gross, primaryCurrency) : "—"),
      className: "mono text-end",
    },
    {
      header: { label: "Gross (USD)", className: "text-end" },
      cell: (d) => (d.gross_usd > 0 ? fmtMoney(d.gross_usd, "usd") : "—"),
      className: "mono text-end",
    },
    {
      header: { label: "Net (USD)", className: "text-end" },
      cell: (d) => (d.net_usd > 0 ? fmtMoney(d.net_usd, "usd") : "—"),
      className: "mono text-end",
    },
  ];

  return (
    <div>
      <div class="row g-3 mb-3">
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <div class="text-uppercase small fw-bold text-muted mb-1">Total Gross (USD)</div>
              <div class="fs-3 fw-bold">{fmtMoney(don.totals.gross_usd, "usd")}</div>
              <div class="text-muted small mt-1">Completed USD donations, before fees</div>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <div class="text-uppercase small fw-bold text-muted mb-1">Total Net (USD)</div>
              <div class="fs-3 fw-bold">{fmtMoney(don.totals.net_usd, "usd")}</div>
              <div class="text-muted small mt-1">After payment processing fees</div>
            </div>
          </div>
        </div>
      </div>
      <div class="card border-0 shadow-sm">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations by Status &amp; Currency</h6>
          <DataTable
            columns={[
              { header: "Status", cell: (d) => <Badge status={d.status} /> },
              { header: "Currency", cell: (d) => d.currency.toUpperCase(), className: "mono" },
              { header: { label: "Count", className: "text-end" }, cell: (d) => d.count, className: "mono text-end" },
              {
                header: { label: "Gross", className: "text-end" },
                cell: (d) => fmtMoney(d.total_gross, d.currency),
                className: "mono text-end",
              },
              {
                header: { label: "Avg Gross", className: "text-end" },
                cell: (d) => fmtMoney(d.avg_gross, d.currency),
                className: "mono text-end",
              },
              {
                header: { label: "Net Total", className: "text-end" },
                cell: (d) => (d.total_net != null ? fmtMoney(d.total_net, d.currency) : `— (${d.status})`),
                className: "mono text-end",
              },
            ]}
            data={don.byCurrency}
            empty="No donations"
          />
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Daily (last 30 days)</h6>
          {dailyAmountChart && <div dangerouslySetInnerHTML={{ __html: dailyAmountChart }} />}
          <DataTable columns={periodColumns} data={don.daily} empty="No data" />
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Weekly (last 12 weeks)</h6>
          {weeklyAmountChart && <div dangerouslySetInnerHTML={{ __html: weeklyAmountChart }} />}
          <DataTable columns={periodColumns} data={don.weekly} empty="No data" />
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations — Monthly (last 12 months)</h6>
          <div dangerouslySetInnerHTML={{ __html: monthlyCountChart }} />
          {monthlyAmountChart && <div dangerouslySetInnerHTML={{ __html: monthlyAmountChart }} />}
          <DataTable columns={periodColumns} data={don.monthly} empty="No data" />
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
    <DataTable
      columns={[
        { header: "Status", cell: (e) => <Badge status={e[0]} /> },
        { header: { label: "Count", className: "text-end" }, cell: (e) => e[1], className: "mono text-end" },
      ]}
      data={entries}
      empty="None"
    />
  );
}

function SimpleTable({ rows, heads = ["Item", "Count"] }: { rows: Array<[string, string]>; heads?: [string, string] }) {
  return (
    <DataTable
      columns={[
        { header: heads[0], cell: (r) => r[0] },
        { header: { label: heads[1], className: "text-end" }, cell: (r) => r[1], className: "mono text-end" },
      ]}
      data={rows}
      empty="No data"
    />
  );
}
