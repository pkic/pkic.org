import { ActivityChartCard } from "../../../../components/analytics/ActivityChartCard";
import { fmtMoney, recentActivityChart, statusBars } from "../../../../components/analytics/charts";
import { DataTable } from "../../../../components/Table";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { StatCard } from "../../../../components/StatCard";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { analyticsSummaryResponseSchema } from "../../../../../shared/schemas/analytics";

export function AnalyticsOverview() {
  const state = useData(() => getJson("/api/v1/analytics/summary", analyticsSummaryResponseSchema), []);

  if (state.loading) return <Spinner />;
  if (state.error) return <ErrorAlert error={state.error} />;
  if (!state.data) return null;

  const { registrations, invites, email, donations } = state.data;
  const donationCompleted = donations.byStatus.completed ?? 0;
  const donationPending = donations.byStatus.pending ?? 0;
  const donationFailed = donations.byStatus.failed ?? 0;
  const donationExpired = donations.byStatus.expired ?? 0;

  return (
    <div>
      <div class="stat-grid mb-4">
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

      <div class="row g-3">
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations by Status</h6>
              <div dangerouslySetInnerHTML={{ __html: statusBars(registrations.byStatus, registrations.total) }} />
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">Top Events</h6>
              <DataTable
                columns={[
                  { header: "Event", cell: (event) => event.name },
                  {
                    header: { label: "Confirmed", className: "text-end" },
                    cell: (event) => event.confirmed,
                    className: "mono text-end",
                  },
                  {
                    header: { label: "Total", className: "text-end" },
                    cell: (event) => event.total,
                    className: "mono text-end",
                  },
                ]}
                data={state.data.topEvents}
                empty="No events"
                rowKey={(event) => event.slug}
              />
            </div>
          </div>
        </div>
      </div>

      <ActivityChartCard chart={recentActivityChart(state.data.recentActivity)} />
    </div>
  );
}
