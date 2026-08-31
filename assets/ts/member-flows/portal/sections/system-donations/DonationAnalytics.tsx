import { Badge } from "../../../../components/Badge";
import { fmtMoney, svgBarChart, svgStackedBarChart } from "../../../../ui/chart";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { DataTable, type Column } from "../../../../components/Table";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { donationAnalyticsResponseSchema, type DonationPeriod } from "../../../../../shared/schemas/analytics";

interface LabeledDonationPeriod extends DonationPeriod {
  date?: string;
  week?: string;
  month?: string;
}

function amountChart(labels: string[], periods: DonationPeriod[], caption: string): string {
  const grossValues = periods.map((period) => period.grossUsd);
  if (!grossValues.some((value) => value > 0)) return "";
  return svgStackedBarChart(
    labels,
    [
      { label: "Net (USD)", values: periods.map((period) => period.netUsd), color: "var(--pk-ok)" },
      {
        label: "Fees",
        values: periods.map((period) => Math.max(0, period.grossUsd - period.netUsd)),
        color: "var(--pk-line-strong)",
      },
    ],
    { caption, valueFormatter: (value: number) => fmtMoney(value, "usd") },
  );
}

function periodLabel(period: LabeledDonationPeriod): string {
  return period.date ?? period.week ?? period.month ?? "";
}

const periodColumns: Column<LabeledDonationPeriod>[] = [
  { header: "Period", cell: periodLabel, className: "mono" },
  { header: { label: "Total", className: "text-end" }, cell: (row) => row.count, className: "mono text-end" },
  {
    header: { label: "Completed", className: "text-end" },
    cell: (row) => row.completed,
    className: "mono text-end",
  },
  { header: { label: "Pending", className: "text-end" }, cell: (row) => row.pending, className: "mono text-end" },
  { header: { label: "Failed", className: "text-end" }, cell: (row) => row.failed, className: "mono text-end" },
  { header: { label: "Expired", className: "text-end" }, cell: (row) => row.expired, className: "mono text-end" },
  {
    header: { label: "Gross (USD)", className: "text-end" },
    cell: (row) => (row.grossUsd > 0 ? fmtMoney(row.grossUsd, "usd") : "—"),
    className: "mono text-end",
  },
  {
    header: { label: "Net (USD)", className: "text-end" },
    cell: (row) => (row.netUsd > 0 ? fmtMoney(row.netUsd, "usd") : "—"),
    className: "mono text-end",
  },
];

export function DonationAnalytics() {
  const state = useData(() => getJson("/api/v1/analytics/donations", donationAnalyticsResponseSchema), []);

  if (state.loading) return <Spinner label="Loading donation analytics…" />;
  if (state.error) return <ErrorAlert error={state.error} />;
  if (!state.data) return null;

  const donations = state.data.donations;
  const monthlyCountChart = svgBarChart(
    donations.monthly.map((period) => period.month),
    donations.monthly.map((period) => period.completed),
    { caption: "Completed donations per month", valueHeader: "Donations", color: "var(--pk-info)" },
  );
  const dailyAmountChart = amountChart(
    donations.daily.map((period) => period.date.slice(5)),
    donations.daily,
    "Donation amounts per day",
  );
  const weeklyAmountChart = amountChart(
    donations.weekly.map((period) => period.week),
    donations.weekly,
    "Donation amounts per week",
  );
  const monthlyAmountChart = amountChart(
    donations.monthly.map((period) => period.month),
    donations.monthly,
    "Donation amounts per month",
  );

  return (
    <div>
      <div class="row g-3 mb-3">
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <div class="text-uppercase small fw-bold text-muted mb-1">Total Gross (USD)</div>
              <div class="fs-3 fw-bold">{fmtMoney(donations.totals.grossUsd, "usd")}</div>
              <div class="text-muted small mt-1">Completed USD donations, before fees</div>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <div class="text-uppercase small fw-bold text-muted mb-1">Total Net (USD)</div>
              <div class="fs-3 fw-bold">{fmtMoney(donations.totals.netUsd, "usd")}</div>
              <div class="text-muted small mt-1">After payment processing fees</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Donations by Status and Currency</h6>
          <DataTable
            columns={[
              { header: "Status", cell: (row) => <Badge status={row.status} /> },
              { header: "Currency", cell: (row) => row.currency.toUpperCase(), className: "mono" },
              {
                header: { label: "Count", className: "text-end" },
                cell: (row) => row.count,
                className: "mono text-end",
              },
              {
                header: { label: "Gross", className: "text-end" },
                cell: (row) => fmtMoney(row.totalGross, row.currency),
                className: "mono text-end",
              },
              {
                header: { label: "Average Gross", className: "text-end" },
                cell: (row) => fmtMoney(row.averageGross, row.currency),
                className: "mono text-end",
              },
              {
                header: { label: "Net Total", className: "text-end" },
                cell: (row) => (row.totalNet === null ? "—" : fmtMoney(row.totalNet, row.currency)),
                className: "mono text-end",
              },
            ]}
            data={donations.byCurrency}
            empty="No donations recorded yet"
          />
        </div>
      </div>

      <PeriodCard title="Donations — Daily (last 30 days)" chart={dailyAmountChart} rows={donations.daily} />
      <PeriodCard title="Donations — Weekly (last 12 weeks)" chart={weeklyAmountChart} rows={donations.weekly} />
      <PeriodCard
        title="Donations — Monthly (last 12 months)"
        chart={`${monthlyCountChart}${monthlyAmountChart}`}
        rows={donations.monthly}
      />
    </div>
  );
}

function PeriodCard({ title, chart, rows }: { title: string; chart: string; rows: LabeledDonationPeriod[] }) {
  return (
    <div class="card border-0 shadow-sm mt-3">
      <div class="card-body">
        <h6 class="text-uppercase small fw-bold text-muted mb-3">{title}</h6>
        {chart && <div dangerouslySetInnerHTML={{ __html: chart }} />}
        <DataTable columns={periodColumns} data={rows} empty="No donations recorded for this period" />
      </div>
    </div>
  );
}
