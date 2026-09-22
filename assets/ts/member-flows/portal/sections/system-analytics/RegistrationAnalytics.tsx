import { useState } from "preact/hooks";
import { StackedBarChart } from "../../../../ui/StackedBarChart";
import { statusBars } from "../../../../ui/chart";
import { statusLabel } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TabList } from "../../../../ui/TabList";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { registrationAnalyticsResponseSchema } from "../../../../../shared/schemas/analytics";
import { attendanceTypeLabel } from "../../../../shared/attendance";

const PERIODS = [
  { id: "weekly", label: "Weekly", panelId: "registration-period" },
  { id: "monthly", label: "Monthly", panelId: "registration-period" },
];

export function RegistrationAnalytics() {
  const [period, setPeriod] = useState("weekly");
  const state = useData(() => getJson("/api/v1/analytics/registrations", registrationAnalyticsResponseSchema), []);
  if (state.loading) return <Spinner label="Loading registration analytics…" />;
  if (state.error) return <ErrorAlert error={state.error} />;
  if (!state.data) return null;
  const { registrations } = state.data;
  const weekly = period === "weekly";
  const labels = weekly ? registrations.weekly.map((row) => row.week) : registrations.monthly.map((row) => row.month);
  const counts = (weekly ? registrations.weekly : registrations.monthly).map((row) => row.count);
  const breakdowns = [
    {
      title: "By status",
      counts: Object.fromEntries(
        Object.entries(registrations.byStatus).map(([key, count]) => [statusLabel(key), count]),
      ),
    },
    {
      title: "By attendance type",
      counts: Object.fromEntries(
        Object.entries(registrations.byAttendanceType).map(([key, count]) => [attendanceTypeLabel(key), count]),
      ),
    },
  ];
  return (
    <div class="pk pk-stack">
      <Panel>
        <PanelHeader
          title={weekly ? "Registrations — Weekly (last 12 weeks)" : "Registrations — Monthly (last 12 months)"}
        />
        <PanelBody>
          <TabList
            items={PERIODS}
            activeId={period}
            onSelect={setPeriod}
            label="Registration period"
            idPrefix="registration-period-tab"
          />
          <div id="registration-period" role="tabpanel" aria-labelledby={`registration-period-tab-${period}`}>
            <StackedBarChart
              labels={labels}
              series={[{ label: "Registrations", values: counts, color: "var(--pk-ok)" }]}
              caption={weekly ? "Registrations per week" : "Registrations per month"}
            />
          </div>
        </PanelBody>
      </Panel>
      <div class="pk-grid pk-grid--cards">
        {breakdowns.map(({ title, counts }) => (
          <Panel key={title}>
            <PanelHeader title={title} />
            <PanelBody>
              <div
                dangerouslySetInnerHTML={{
                  __html: statusBars(
                    counts,
                    Object.values(counts).reduce((sum, value) => sum + value, 0),
                  ),
                }}
              />
            </PanelBody>
          </Panel>
        ))}
      </div>
    </div>
  );
}
