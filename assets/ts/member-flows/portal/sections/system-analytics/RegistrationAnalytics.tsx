/**
 * System Analytics — the Registrations tab.
 *
 * Migrated off Bootstrap onto the design system. The four `card` blocks are
 * Panels, so each title is a real heading instead of a `h6` carrying its own
 * type scale; the `row`/`col-md-6` pair is the system's responsive grid, which
 * needs no breakpoint classes; and the `mb-3`/`mt-3` on every child is one
 * `gap` on the stack that holds them.
 *
 * The period tables are named for the panel they sit in rather than for the
 * chart above them. Each chart already emits its own visually hidden data
 * table captioned "Registrations per week"/"per month", so reusing that
 * caption here announced two identically named tables in the same panel.
 */

import { svgBarChart } from "../../../../ui/chart";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { registrationAnalyticsResponseSchema } from "../../../../../shared/schemas/analytics";
import { SimpleTable, StatusTable } from "./Tables";

const ATTENDANCE_LABELS: Record<string, string> = {
  in_person: "In person",
  virtual: "Virtual",
  on_demand: "On demand",
};

const WEEKLY_TITLE = "Registrations — Weekly (last 12 weeks)";
const MONTHLY_TITLE = "Registrations — Monthly (last 12 months)";

export function RegistrationAnalytics() {
  const state = useData(() => getJson("/api/v1/analytics/registrations", registrationAnalyticsResponseSchema), []);

  if (state.loading) return <Spinner label="Loading registration analytics…" />;
  if (state.error) return <ErrorAlert error={state.error} />;
  if (!state.data) return null;

  const registrations = state.data.registrations;
  const weeklyChart = svgBarChart(
    registrations.weekly.map((period) => period.week.slice(5)),
    registrations.weekly.map((period) => period.count),
    { caption: "Registrations per week", valueHeader: "Registrations" },
  );
  const monthlyChart = svgBarChart(
    registrations.monthly.map((period) => period.month),
    registrations.monthly.map((period) => period.count),
    { caption: "Registrations per month", valueHeader: "Registrations" },
  );

  return (
    <div class="pk pk-stack">
      <div class="pk-grid pk-grid--roomy">
        <Panel>
          <PanelHeader title="By Status" />
          <PanelBody>
            <StatusTable caption="Registrations by status" entries={Object.entries(registrations.byStatus)} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="By Attendance Type" />
          <PanelBody>
            <SimpleTable
              caption="Registrations by attendance type"
              rows={Object.entries(registrations.byAttendanceType).map(([key, count]) => [
                ATTENDANCE_LABELS[key] ?? key,
                String(count),
              ])}
            />
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title={WEEKLY_TITLE} />
        <PanelBody class="pk-stack pk-stack--snug">
          <div dangerouslySetInnerHTML={{ __html: weeklyChart }} />
          <SimpleTable
            caption={WEEKLY_TITLE}
            rows={registrations.weekly.map((period) => [period.week, String(period.count)])}
            heads={["Week", "Count"]}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={MONTHLY_TITLE} />
        <PanelBody class="pk-stack pk-stack--snug">
          <div dangerouslySetInnerHTML={{ __html: monthlyChart }} />
          <SimpleTable
            caption={MONTHLY_TITLE}
            rows={registrations.monthly.map((period) => [period.month, String(period.count)])}
            heads={["Month", "Count"]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
