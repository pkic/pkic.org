import { StatCard } from "../../components/StatCard";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { DataTable } from "../../components/Table";
import { api } from "../api";
import { adminStatsResponseSchema } from "../../../shared/schemas/admin-analytics";
import { fmtMoney, recentActivityChart, statusBars } from "../charts";
import type { StatsResponse } from "../types";
import { useHashLocation } from "wouter/use-hash-location";
import { useData } from "../../hooks/useData";
import { ActivityChartCard } from "../components/ActivityChartCard";

export function Dashboard() {
  const [, navigate] = useHashLocation();
  const {
    data: stats,
    loading,
    error,
  } = useData<StatsResponse>(() => api("/api/v1/admin/stats", adminStatsResponseSchema), []);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!stats) return null;

  const { registrations: r, email: em, invites: inv, donations: don } = stats;
  const donCompleted = don.byStatus.completed ?? 0;
  const donPending = don.byStatus.pending ?? 0;
  const donFailed = don.byStatus.failed ?? 0;
  const donExpired = don.byStatus.expired ?? 0;

  const activityChart = recentActivityChart(stats.recentActivity);

  return (
    <div>
      {/* Stat grid */}
      <div class="stat-grid mb-4">
        <StatCard label="Total Registrations" value={r.total} note={`${r.byStatus.registered ?? 0} confirmed`} />
        <StatCard label="Pending Invites" value={inv.byStatus.sent ?? 0} note={`${inv.total} total`} />
        <StatCard label="Queued Emails" value={em.totalQueued} note="" />
        <StatCard
          label="Failed Emails"
          value={em.totalFailed}
          note="go to Email tab to fix"
          variant={em.totalFailed > 0 ? "danger" : undefined}
        />
        <StatCard
          label="Completed Donations"
          value={donCompleted}
          note={don.totals.gross_usd > 0 ? `${fmtMoney(don.totals.gross_usd, "usd")} gross` : "no data"}
        />
        <StatCard
          label="Pending Donations"
          value={donPending}
          note={
            [donFailed > 0 ? `${donFailed} failed` : "", donExpired > 0 ? `${donExpired} expired` : ""]
              .filter(Boolean)
              .join(" · ") || "none failed"
          }
          variant={donFailed > 0 ? "danger" : undefined}
        />
      </div>

      <div class="row g-3">
        {/* Registrations by status */}
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations by Status</h6>
              <div dangerouslySetInnerHTML={{ __html: statusBars(r.byStatus, r.total) }} />
            </div>
          </div>
        </div>

        {/* Top events */}
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">Top Events</h6>
              <DataTable
                columns={[
                  {
                    header: "Event",
                    cell: (e) => (
                      <button
                        class="btn btn-link p-0 small text-start"
                        onClick={() => navigate(`/events/${encodeURIComponent(e.slug)}`)}
                      >
                        {e.name}
                      </button>
                    ),
                  },
                  {
                    header: { label: "Conf.", className: "text-end" },
                    cell: (e) => e.confirmed,
                    className: "mono text-end",
                  },
                  {
                    header: { label: "Total", className: "text-end" },
                    cell: (e) => e.total,
                    className: "mono text-end",
                  },
                ]}
                data={stats.topEvents}
                empty="No events"
                rowKey={(e) => e.slug}
              />
            </div>
          </div>
        </div>
      </div>

      <ActivityChartCard chart={activityChart} />
    </div>
  );
}
