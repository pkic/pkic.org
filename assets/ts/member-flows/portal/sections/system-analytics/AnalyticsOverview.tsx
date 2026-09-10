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

import { recentActivityChart, statusBars } from "../../../../ui/chart";
import { DataTable } from "../../../../components/Table";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Spinner } from "../../../../components/Spinner";
import { StatCard } from "../../../../components/StatCard";
import { usePortalHashLocation } from "../../hash-location";
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

  /*
   * Registrations, invitations and the events they belong to. The donation
   * figures this panel used to repeat live under /donations/analytics, where
   * the rest of the donation surface is (#39); email queue health belongs to
   * the outbox, which shows it in operational detail rather than as two
   * numbers on a dashboard.
   */
  const { registrations, invites } = state.data;

  return (
    <div class="pk pk-stack">
      <div class="pk-grid pk-grid--tight">
        <StatCard
          label="Total Registrations"
          value={registrations.total}
          note={`${registrations.byStatus.registered ?? 0} confirmed`}
        />
        <StatCard label="Pending Invites" value={invites.byStatus.sent ?? 0} note={`${invites.total} total`} />
      </div>

      <div class="pk-grid pk-grid--roomy">
        <Panel>
          <PanelHeader title="Registrations by Status" />
          <PanelBody>
            <div dangerouslySetInnerHTML={{ __html: statusBars(registrations.byStatus, registrations.total) }} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Top Events" />
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
              // Each row names an event, so it opens that event (#45) — which
              // is most of the point of a "top events" table.
              rowAction={(event) => ({
                label: `Open ${event.name}`,
                href: usePortalHashLocation.hrefs(`/events/${encodeURIComponent(event.slug)}`),
              })}
            />
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Activity — last 30 days" />
        <PanelBody>
          <div dangerouslySetInnerHTML={{ __html: recentActivityChart(state.data.recentActivity) }} />
        </PanelBody>
      </Panel>
    </div>
  );
}
