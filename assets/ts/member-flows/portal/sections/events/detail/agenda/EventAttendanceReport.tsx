import { useState } from "preact/hooks";
import { attendanceScopeQuerySchema } from "../../../../../../../shared/schemas/event-attendance-reporting";
import { attendanceReportSchema } from "../../../../../../../shared/schemas/event-participation-reporting";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { ButtonLink } from "../../../../../../ui/Button";
import { attendanceSummaryExportQuerySchema } from "../../../../../../../shared/schemas/event-attendance-exports";
import type { EventContactRetention } from "../../../../../../../shared/schemas/event-contact-retention";
import { useLiveBrowserSession } from "../../../../../../hooks/useLiveBrowserSession";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { AttendanceSummary } from "./AttendanceSummary";
import { EventAttendanceDetails } from "./EventAttendanceDetails";
export function EventAttendanceReport({ slug, timeZone, epoch }: { slug: string; timeZone: string; epoch: number }) {
  const [day, setDay] = useState("");
  const [mode, setMode] = useState("");
  const [session, setSession] = useState<{ occurrenceId: string; title: string } | null>(null);
  const [retention, setRetention] = useState<EventContactRetention | null>(null);
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
  const base = `/api/v1/events/${encodeURIComponent(slug)}/attendance`;
  return (
    <Panel>
      <PanelHeader title="Event and day attendance" />
      <PanelBody class="pk-stack">
        <p>
          Days use the calendar date recorded at capture. Leave the day empty for the whole event. Current reservations
          follow the current approved schedule.
        </p>
        <div class="pk-cluster" {...form.handlers}>
          <Field label="Event day" {...form.of("dayDate")}>
            {(control) => (
              <TextInput
                {...control}
                name="dayDate"
                type="date"
                value={day}
                onInput={(change) => setDay(change.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Attendance mode" {...form.of("attendanceMode")}>
            {(control) => (
              <Select
                {...control}
                name="attendanceMode"
                value={mode}
                onChange={(change) => setMode(change.currentTarget.value)}
              >
                <option value="">All modes</option>
                {attendanceScopeQuerySchema.shape.attendanceMode.unwrap().options.map((value) => (
                  <option value={value}>{value === "physical" ? "Physical" : "Virtual"}</option>
                ))}
              </Select>
            )}
          </Field>
          {browser.live && (
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
          )}
        </div>
        {!browser.live ? (
          <p>Reconnect and keep this screen visible to view live attendance details.</p>
        ) : (
          parsed.success && (
            <div class="pk-stack" key={`${slug}:${epoch}:${browser.epoch}:${JSON.stringify(params)}`}>
              <AttendanceSummary
                endpoint={`${base}/summary?${new URLSearchParams(params)}`}
                onContactRetention={setRetention}
              />
              <ButtonLink
                href={`${base}/summary/exports?${new URLSearchParams(attendanceSummaryExportQuerySchema.parse(params))}`}
              >
                Export attendance summary
              </ButtonLink>
              <EventAttendanceDetails
                base={base}
                params={params}
                timeZone={timeZone}
                allowIdentityViews={retention?.state !== "closed"}
              />
            </div>
          )
        )}
      </PanelBody>
    </Panel>
  );
}
