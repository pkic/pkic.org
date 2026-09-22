/** Event registration and invitation summaries, with a link to browsable event records. */
import { recentActivityChart, statusBars } from "../../../../ui/chart";
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
      <div class="pk-stat-row">
        <StatCard
          label="Total Registrations"
          value={registrations.total}
          note={`${registrations.byStatus.registered ?? 0} confirmed`}
        />
        <StatCard label="Pending Invites" value={invites.byStatus.sent ?? 0} note={`${invites.total} total`} />
      </div>

      <div class="pk-grid pk-grid--cards">
        <Panel>
          <PanelHeader title="Registrations by Status" />
          <PanelBody>
            <div dangerouslySetInnerHTML={{ __html: statusBars(registrations.byStatus, registrations.total) }} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Top Events" />
          <PanelBody class="pk-stack">
            <div
              dangerouslySetInnerHTML={{
                __html: statusBars(
                  Object.fromEntries(state.data.topEvents.map((event) => [event.name, event.total])),
                  state.data.topEvents.reduce((sum, event) => sum + event.total, 0),
                ),
              }}
            />
            <a href={usePortalHashLocation.hrefs("/events")}>Browse events →</a>
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
