/**
 * Donation analytics — what the donations add up to, and how they moved over
 * a day, a week and a month.
 *
 * Four tables used to sit stacked down one page, so reading the weekly figures
 * meant scrolling past the daily ones and the reader lost the overview (#43).
 * They are tabs now, above the two headline totals that stay on screen
 * whichever view is open. Each tab is a place with its own address — the same
 * arrangement the event analytics use — so a weekly figure can be linked to
 * and survives a reload.
 *
 * Migrated off Bootstrap onto the design system: the headline figures were a
 * pair of `card`s carrying their own type scale, and are StatCards now, so the
 * label/value/note relationship is the system's rather than re-derived here.
 */

import { Badge } from "../../../../components/Badge";
import { Tabs } from "../../../../components/Tabs";
import { fmtMoney, svgBarChart, svgStackedBarChart } from "../../../../ui/chart";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { DataTable, type Column } from "../../../../components/Table";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import {
  donationAnalyticsResponseSchema,
  type DonationPeriod,
  type DonationAnalytics as DonationAnalyticsData,
} from "../../../../../shared/schemas/analytics";
// `pk-mono` is defined in Content.css, which ships in a lazy chunk. A surface
// that writes the class name has to import the stylesheet itself, or the cells
// render in the body face on any page that is no longer loading Bootstrap.
import "../../../../ui/Content.css";

interface LabeledDonationPeriod extends DonationPeriod {
  date?: string;
  week?: string;
  month?: string;
}

type AnalyticsView = "status" | "daily" | "weekly" | "monthly";

/** The default view owns the bare `/donations/analytics` address. */
const VIEWS: ReadonlyArray<{ key: AnalyticsView; label: string; path: string }> = [
  { key: "status", label: "By status", path: "/donations/analytics" },
  { key: "daily", label: "Daily", path: "/donations/analytics/daily" },
  { key: "weekly", label: "Weekly", path: "/donations/analytics/weekly" },
  { key: "monthly", label: "Monthly", path: "/donations/analytics/monthly" },
];

const VIEW_PATH: Record<string, string> = Object.fromEntries(VIEWS.map((view) => [view.key, view.path]));

function analyticsView(segment: string | undefined): AnalyticsView {
  return VIEWS.find((view) => view.key === segment)?.key ?? "status";
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

/**
 * Donation analytics, as a page of its own.
 *
 * It is reached from the sidebar, under Donations — and a menu item that
 * names a page has to open that page, not the neighbouring page with a tab
 * selected on it. That is what the report in #43 was about, and it is why
 * this heads itself rather than borrowing the donations list's heading.
 *
 * The four periods are tabs *within* it, because they are one question asked
 * at four resolutions rather than four destinations; each is addressable, and
 * the headline totals stay above them so the overview survives the choice.
 */
export function DonationAnalytics({ view }: { view?: string }) {
  const state = useData(() => getJson("/api/v1/analytics/donations", donationAnalyticsResponseSchema), []);
  const active = analyticsView(view);

  return (
    <section class="pk pk-stack" aria-label="Donation analytics">
      <PageHeader title="Donation analytics" />
      {state.loading && <Spinner label="Loading donation analytics…" />}
      {!state.loading && state.error && <ErrorAlert error={state.error} />}
      {!state.loading && !state.error && state.data && <AnalyticsViews data={state.data} active={active} />}
    </section>
  );
}

function AnalyticsViews({ data, active }: { data: DonationAnalyticsData; active: AnalyticsView }) {
  const donations = data.donations;

  return (
    <>
      {/* The totals belong to every view, so they stay above the strip: the
          reader keeps the overview while looking at one period. */}
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

      {/*
       * Real links rather than `role="tab"` buttons: each view is a place with
       * a URL, so the strip stays a wouter <Link> carrying `aria-current`
       * instead of promising arrow-key movement the browser handles as
       * navigation. The strip navigates on its own, so `onChange` has nothing
       * left to do.
       */}
      <Tabs
        label="Donation analytics"
        items={VIEWS.map((view) => ({ key: view.key, label: view.label }))}
        active={active}
        hrefFor={(key) => VIEW_PATH[key]}
      />

      {active === "status" && <StatusAndCurrency rows={donations.byCurrency} />}
      {active === "daily" && (
        <PeriodPanel
          title="Donations — Daily (last 30 days)"
          chart={amountChart(
            donations.daily.map((period) => period.date.slice(5)),
            donations.daily,
            "Donation amounts per day",
          )}
          rows={donations.daily}
        />
      )}
      {active === "weekly" && (
        <PeriodPanel
          title="Donations — Weekly (last 12 weeks)"
          chart={amountChart(
            donations.weekly.map((period) => period.week),
            donations.weekly,
            "Donation amounts per week",
          )}
          rows={donations.weekly}
        />
      )}
      {active === "monthly" && (
        <PeriodPanel
          title="Donations — Monthly (last 12 months)"
          chart={`${svgBarChart(
            donations.monthly.map((period) => period.month),
            donations.monthly.map((period) => period.completed),
            { caption: "Completed donations per month", valueHeader: "Donations", color: "var(--pk-info)" },
          )}${amountChart(
            donations.monthly.map((period) => period.month),
            donations.monthly,
            "Donation amounts per month",
          )}`}
          rows={donations.monthly}
        />
      )}
    </>
  );
}

function StatusAndCurrency({ rows }: { rows: DonationAnalyticsData["donations"]["byCurrency"] }) {
  return (
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
          data={rows}
          empty="No donations recorded yet"
        />
      </PanelBody>
    </Panel>
  );
}

function PeriodPanel({ title, chart, rows }: { title: string; chart: string; rows: LabeledDonationPeriod[] }) {
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
