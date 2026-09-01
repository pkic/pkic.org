/**
 * Donation analytics — the Stats tab of the donations surface.
 *
 * Migrated off Bootstrap onto the design system. The two headline figures were
 * a pair of `card`s carrying their own type scale (`fs-3 fw-bold`,
 * `text-uppercase small fw-bold text-muted`); they are StatCards now, so the
 * label/value/note relationship is the system's rather than re-derived here.
 * Column `className`s speak the design system's vocabulary (`pk-mono`,
 * `pk-end`) rather than Bootstrap's, which `components/Table` translates into
 * alignment and cell utilities.
 */

import { Badge } from "../../../../components/Badge";
import { fmtMoney, svgBarChart, svgStackedBarChart } from "../../../../ui/chart";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { DataTable, type Column } from "../../../../components/Table";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { donationAnalyticsResponseSchema, type DonationPeriod } from "../../../../../shared/schemas/analytics";
// `pk-mono` is defined in Content.css, which ships in a lazy chunk. A surface
// that writes the class name has to import the stylesheet itself, or the cells
// render in the body face on any page that is no longer loading Bootstrap.
import "../../../../ui/Content.css";

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
  { header: "Period", cell: periodLabel, className: "pk-mono pk-nowrap" },
  { header: { label: "Total", className: "pk-end" }, cell: (row) => row.count, className: "pk-mono pk-end" },
  {
    header: { label: "Completed", className: "pk-end" },
    cell: (row) => row.completed,
    className: "pk-mono pk-end",
  },
  { header: { label: "Pending", className: "pk-end" }, cell: (row) => row.pending, className: "pk-mono pk-end" },
  { header: { label: "Failed", className: "pk-end" }, cell: (row) => row.failed, className: "pk-mono pk-end" },
  { header: { label: "Expired", className: "pk-end" }, cell: (row) => row.expired, className: "pk-mono pk-end" },
  {
    header: { label: "Gross (USD)", className: "pk-end" },
    cell: (row) => (row.grossUsd > 0 ? fmtMoney(row.grossUsd, "usd") : "—"),
    className: "pk-mono pk-end",
  },
  {
    header: { label: "Net (USD)", className: "pk-end" },
    cell: (row) => (row.netUsd > 0 ? fmtMoney(row.netUsd, "usd") : "—"),
    className: "pk-mono pk-end",
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
    <div class="pk pk-stack">
      <div class="pk-grid">
        <StatCard
          label="Total Gross (USD)"
          value={fmtMoney(donations.totals.grossUsd, "usd")}
          note="Completed USD donations, before fees"
        />
        <StatCard
          label="Total Net (USD)"
          value={fmtMoney(donations.totals.netUsd, "usd")}
          note="After payment processing fees"
        />
      </div>

      <Panel>
        <PanelHeader title="Donations by status and currency" headingLevel={2} />
        <PanelBody>
          <DataTable
            caption="Donations by status and currency"
            columns={[
              { header: "Status", cell: (row) => <Badge status={row.status} /> },
              { header: "Currency", cell: (row) => row.currency.toUpperCase(), className: "pk-mono" },
              {
                header: { label: "Count", className: "pk-end" },
                cell: (row) => row.count,
                className: "pk-mono pk-end",
              },
              {
                header: { label: "Gross", className: "pk-end" },
                cell: (row) => fmtMoney(row.totalGross, row.currency),
                className: "pk-mono pk-end",
              },
              {
                header: { label: "Average Gross", className: "pk-end" },
                cell: (row) => fmtMoney(row.averageGross, row.currency),
                className: "pk-mono pk-end",
              },
              {
                header: { label: "Net Total", className: "pk-end" },
                cell: (row) => (row.totalNet === null ? "—" : fmtMoney(row.totalNet, row.currency)),
                className: "pk-mono pk-end",
              },
            ]}
            data={donations.byCurrency}
            empty="No donations recorded yet"
          />
        </PanelBody>
      </Panel>

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
    <Panel>
      <PanelHeader title={title} headingLevel={2} />
      <PanelBody class="pk-stack pk-stack--snug">
        {chart && <div dangerouslySetInnerHTML={{ __html: chart }} />}
        <DataTable caption={title} columns={periodColumns} data={rows} empty="No donations recorded for this period" />
      </PanelBody>
    </Panel>
  );
}
