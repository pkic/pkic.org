/**
 * System Analytics — the Overview tab.
 *
 * Migrated off Bootstrap onto the design system. The three `card` blocks are
 * Panels, so their titles are real headings rather than a `h6` carrying its own
 * type scale (`text-uppercase small fw-bold text-muted`); the `row`/`col-md-6`
 * pair and the legacy `stat-grid` are the system's responsive grid, which has
 * no breakpoint classes at all; and the spacing that was on each child
 * (`mb-3`, `mb-4`, `mt-3`) is one `gap` on the parent stack.
 *
 * The "Activity — last 30 days" card was a one-consumer wrapper component
 * (`components/analytics/ActivityChartCard`) whose whole body was Bootstrap
 * markup. It is a Panel here, in the surface that renders it, rather than a
 * component indirection around three elements.
 */

import { fmtMoney, recentActivityChart, statusBars } from "../../../../ui/chart";
import { DataTable } from "../../../../components/Table";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Spinner } from "../../../../components/Spinner";
import { StatCard } from "../../../../components/StatCard";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { analyticsSummaryResponseSchema } from "../../../../../shared/schemas/analytics";
// `pk-mono` is defined in Content.css, which ships in a lazy chunk. A module
// that writes the class name imports the stylesheet itself.
import "../../../../ui/Content.css";

export function AnalyticsOverview() {
  const state = useData(() => getJson("/api/v1/analytics/summary", analyticsSummaryResponseSchema), []);

  if (state.loading) return <Spinner label="Loading analytics…" />;
  if (state.error) return <ErrorAlert error={state.error} />;
  if (!state.data) return null;

  const { registrations, invites, email, donations } = state.data;
  const donationCompleted = donations.byStatus.completed ?? 0;
  const donationPending = donations.byStatus.pending ?? 0;
  const donationFailed = donations.byStatus.failed ?? 0;
  const donationExpired = donations.byStatus.expired ?? 0;

  return (
    <div class="pk pk-stack">
      <div class="pk-grid pk-grid--tight">
        <StatCard
          label="Total Registrations"
          value={registrations.total}
          note={`${registrations.byStatus.registered ?? 0} confirmed`}
        />
        <StatCard label="Pending Invites" value={invites.byStatus.sent ?? 0} note={`${invites.total} total`} />
        <StatCard label="Queued Emails" value={email.totalQueued} note="" />
        <StatCard
          label="Failed Emails"
          value={email.totalFailed}
          note={email.totalBounced > 0 ? `${email.totalBounced} bounced` : ""}
          variant={email.totalFailed > 0 ? "danger" : undefined}
        />
        <StatCard
          label="Completed Donations"
          value={donationCompleted}
          note={donations.totals.grossUsd > 0 ? `${fmtMoney(donations.totals.grossUsd, "usd")} gross` : "no data"}
        />
        <StatCard
          label="Pending Donations"
          value={donationPending}
          note={
            [
              donationFailed > 0 ? `${donationFailed} failed` : "",
              donationExpired > 0 ? `${donationExpired} expired` : "",
            ]
              .filter(Boolean)
              .join(" · ") || "none failed"
          }
          variant={donationFailed > 0 ? "danger" : undefined}
        />
      </div>

      <div class="pk-grid pk-grid--roomy">
        <Panel>
          <PanelHeader title="Registrations by Status" headingLevel={2} />
          <PanelBody>
            <div dangerouslySetInnerHTML={{ __html: statusBars(registrations.byStatus, registrations.total) }} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Top Events" headingLevel={2} />
          <PanelBody>
            <DataTable
              caption="Top events by registrations"
              columns={[
                { header: "Event", cell: (event) => event.name },
                {
                  header: { label: "Confirmed", className: "pk-end" },
                  cell: (event) => event.confirmed,
                  className: "pk-mono pk-end",
                },
                {
                  header: { label: "Total", className: "pk-end" },
                  cell: (event) => event.total,
                  className: "pk-mono pk-end",
                },
              ]}
              data={state.data.topEvents}
              empty="No event registration activity yet"
              rowKey={(event) => event.slug}
            />
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Activity — last 30 days" headingLevel={2} />
        <PanelBody>
          <div dangerouslySetInnerHTML={{ __html: recentActivityChart(state.data.recentActivity) }} />
        </PanelBody>
      </Panel>
    </div>
  );
}
