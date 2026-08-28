import { svgBarChart } from "../../../../components/analytics/charts";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { systemRegistrationAnalyticsResponseSchema } from "../../../../../shared/schemas/system-analytics";
import { SimpleTable, StatusTable } from "./Tables";

const ATTENDANCE_LABELS: Record<string, string> = {
  in_person: "In person",
  virtual: "Virtual",
  on_demand: "On demand",
};

export function RegistrationAnalytics() {
  const state = useData(
    () => getJson("/api/v1/system/analytics/registrations", systemRegistrationAnalyticsResponseSchema),
    [],
  );

  if (state.loading) return <Spinner />;
  if (state.error) return <ErrorAlert error={state.error} />;
  if (!state.data) return null;

  const registrations = state.data.registrations;
  const weeklyChart = svgBarChart(
    registrations.weekly.map((period) => period.week.slice(5)),
    registrations.weekly.map((period) => period.count),
  );
  const monthlyChart = svgBarChart(
    registrations.monthly.map((period) => period.month),
    registrations.monthly.map((period) => period.count),
  );

  return (
    <div>
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">By Status</h6>
              <StatusTable entries={Object.entries(registrations.byStatus)} />
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card border-0 shadow-sm h-100">
            <div class="card-body">
              <h6 class="text-uppercase small fw-bold text-muted mb-3">By Attendance Type</h6>
              <SimpleTable
                rows={Object.entries(registrations.byAttendanceType).map(([key, count]) => [
                  ATTENDANCE_LABELS[key] ?? key,
                  String(count),
                ])}
              />
            </div>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Weekly (last 12 weeks)</h6>
          <div dangerouslySetInnerHTML={{ __html: weeklyChart }} />
          <SimpleTable
            rows={registrations.weekly.map((period) => [period.week, String(period.count)])}
            heads={["Week", "Count"]}
          />
        </div>
      </div>
      <div class="card border-0 shadow-sm mt-3">
        <div class="card-body">
          <h6 class="text-uppercase small fw-bold text-muted mb-3">Registrations — Monthly (last 12 months)</h6>
          <div dangerouslySetInnerHTML={{ __html: monthlyChart }} />
          <SimpleTable
            rows={registrations.monthly.map((period) => [period.month, String(period.count)])}
            heads={["Month", "Count"]}
          />
        </div>
      </div>
    </div>
  );
}
