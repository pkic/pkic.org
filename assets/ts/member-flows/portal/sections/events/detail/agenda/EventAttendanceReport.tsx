import { type ClockZone } from "../../../../../../../shared/event-clock";
import { useState } from "preact/hooks";
import { AttendanceSummary } from "./AttendanceSummary";
import { EventAttendanceDetails } from "./EventAttendanceDetails";
import { attendancePath } from "./attendance-navigation";
import { attendanceScopeQuerySchema } from "../../../../../../../shared/schemas/event-attendance-reporting";
import { attendanceReportSchema } from "../../../../../../../shared/schemas/event-participation-reporting";
import { attendanceSummaryExportQuerySchema } from "../../../../../../../shared/schemas/event-attendance-exports";
import { useLiveBrowserSession } from "../../../../../../hooks/useLiveBrowserSession";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { ButtonLink } from "../../../../../../ui/Button";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { Alert } from "../../../../../../ui/Alert";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
export function EventAttendanceReport({
  slug,
  timeZone,
  epoch,
  view = "summary",
  basePath = `/events/${slug}/attendance`,
  unsuccessful = false,
  reasons = false,
}: {
  slug: string;
  timeZone: ClockZone;
  epoch: number;
  view?: "summary" | "attendees" | "scan-log" | "diagnostics";
  basePath?: string;
  unsuccessful?: boolean;
  reasons?: boolean;
}) {
  const [day, setDay] = useHashQueryParam("dayDate", "");
  const [mode, setMode] = useHashQueryParam("attendanceMode", "");
  const [occurrenceId, setOccurrenceId] = useHashQueryParam("occurrenceId", "");
  const [selectedSession, setSelectedSession] = useState<{ occurrenceId: string; title: string } | null>(null);
  const session = occurrenceId
    ? {
        occurrenceId,
        title: selectedSession?.occurrenceId === occurrenceId ? selectedSession.title : "Selected session",
      }
    : null;
  function setSession(next: { occurrenceId: string; title: string } | null) {
    setSelectedSession(next);
    setOccurrenceId(next?.occurrenceId ?? "");
  }
  const browser = useLiveBrowserSession();
  const query = {
    ...(day ? { dayDate: day } : {}),
    ...(mode ? { attendanceMode: mode } : {}),
    ...(session ? { occurrenceId: session.occurrenceId } : {}),
  };
  const form = useContractForm(attendanceScopeQuerySchema, query);
  const parsed = attendanceScopeQuerySchema.safeParse(query);
  const params = parsed.success
    ? Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, String(value)]))
    : {};
  const scopeQuery = new URLSearchParams(params).toString();
  const link = (section: string, detail?: string) =>
    attendancePath(basePath, section, detail) + (scopeQuery ? `?${scopeQuery}` : "");
  const base = `/api/v1/events/${encodeURIComponent(slug)}/attendance`;
  if (!browser.live) return <Alert tone="info">Reconnect and keep this screen visible to view attendance.</Alert>;
  return (
    <div class="pk-stack" key={`${slug}:${epoch}:${browser.epoch}:${view}`}>
      {(view === "summary" || (view === "diagnostics" && !reasons)) && (
        <div class="pk-cluster" {...form.handlers}>
          <Field label="Event day" {...form.of("dayDate")}>
            {(control) => (
              <TextInput
                {...control}
                name="dayDate"
                type="date"
                value={day}
                onInput={(event) => setDay(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Attendance mode" {...form.of("attendanceMode")}>
            {(control) => (
              <Select
                {...control}
                name="attendanceMode"
                value={mode}
                onChange={(event) => setMode(event.currentTarget.value as typeof mode)}
              >
                <option value="">All modes</option>
                {attendanceScopeQuerySchema.shape.attendanceMode.unwrap().options.map((value) => (
                  <option value={value}>{value === "physical" ? "Physical" : "Virtual"}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Session" {...form.of("occurrenceId")}>
            {(control) => (
              <ServerSearchSelect
                {...control}
                catalog={{
                  endpoint: base,
                  responseSchema: attendanceReportSchema,
                  resolveItems: (value) => value.sessions,
                  resolvePage: (value) => value.page,
                  itemKey: (row) => row.occurrenceId,
                  itemLabel: (row) => row.title,
                  sort: "title",
                }}
                searchLabel="Session"
                placeholder="All sessions"
                value={session?.occurrenceId ?? null}
                selectedLabel={session?.title}
                onChange={setSession}
              />
            )}
          </Field>
        </div>
      )}
      {parsed.success &&
        (view === "summary" || (view === "diagnostics" && !reasons) ? (
          <>
            <AttendanceSummary
              clock={timeZone}
              endpoint={`${base}/summary?${scopeQuery}`}
              diagnostics={view === "diagnostics"}
              unsuccessfulHref={link("scan-log", "unsuccessful")}
              attendeesHref={link("attendees")}
              diagnosticsHref={link("diagnostics")}
            />
            {view === "summary" ? (
              <div class="pk-cluster">
                <DownloadAction
                  label="Download attendance summary (CSV)"
                  href={`${base}/summary/exports?${new URLSearchParams(attendanceSummaryExportQuerySchema.parse(params))}`}
                />
              </div>
            ) : (
              <ButtonLink href={link("diagnostics", "reasons")}>View scan reason breakdown</ButtonLink>
            )}
          </>
        ) : (
          <>
            {view === "diagnostics" && <ButtonLink href={link("diagnostics")}>Back to diagnostics</ButtonLink>}
            <EventAttendanceDetails
              base={base}
              params={{ ...params, ...(unsuccessful ? { unsuccessful: "true" } : {}) }}
              timeZone={timeZone}
              view={view === "attendees" ? "people" : view === "diagnostics" ? "reasons" : "attempts"}
              allScansHref={link("scan-log")}
            />
          </>
        ))}
    </div>
  );
}
