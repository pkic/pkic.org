import { useState } from "preact/hooks";
import { ApiDataTable } from "../../../../../components/ApiDataTable";
import { ButtonLink } from "../../../../../ui/Button";
import {
  sessionDemandReportResponseSchema,
  sessionDemandReportExportQuerySchema,
  type SessionDemandReportRow,
  type SessionDemandReportResponse,
} from "../../../../../../shared/schemas/event-session-demand-report";
import { formatNumber } from "../../../../../../shared/format-number";
import { formatDateTimeInZone } from "../../../../../../shared/format-date";
import { eventParticipationLink } from "../../../../../../shared/event-participation-link";

/** One published-session population for comparison and its matching CSV export. */
export function SessionDemandReport({ slug }: { slug: string }) {
  const [report, setReport] = useState<SessionDemandReportResponse["report"] | null>(null);
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/agenda/reports/demand`;
  return (
    <ApiDataTable<SessionDemandReportRow, SessionDemandReportResponse>
      endpoint={endpoint}
      responseSchema={sessionDemandReportResponseSchema}
      resolve={(response) => response.sessions}
      resolvePage={(response) => response.page}
      onData={(response) => setReport(response.report)}
      paginate
      initialSort="startAt"
      caption={
        report
          ? report.publishedRevision === null
            ? "Session demand · No published agenda"
            : `Session demand · Published revision ${report.publishedRevision} · ${report.timeZone}`
          : "Session demand"
      }
      urlState="sessionDemand"
      empty="No published sessions match these filters."
      rowKey={(row) => `${row.occurrenceId}:${row.attendanceMode}`}
      toolbar={(_actions, query) => {
        const exportQuery = sessionDemandReportExportQuerySchema.parse(
          Object.fromEntries(Object.entries(query).filter(([key]) => key !== "limit" && key !== "offset")),
        );
        const params = new URLSearchParams(Object.entries(exportQuery).map(([key, value]) => [key, String(value)]));
        return (
          <ButtonLink size="sm" href={`${endpoint}/exports?${params.toString()}`}>
            Export CSV
          </ButtonLink>
        );
      }}
      columns={[
        {
          header: "Session",
          width: "primary",
          hideable: false,
          cell: (row) => row.title,
          sort: { asc: "title", desc: "-title" },
        },
        {
          header: "Starts",
          cell: (row) => (report ? formatDateTimeInZone(row.startAt, report.timeZone) : "—"),
          sort: { asc: "startAt", desc: "-startAt" },
          filter: { param: "dayDate", text: { placeholder: "YYYY-MM-DD", hint: "Event-local session day." } },
        },
        {
          header: "Attendance",
          cell: (row) => (row.attendanceMode === "physical" ? "In person" : "Remote"),
          filter: {
            param: "attendanceMode",
            options: [
              { value: "", label: "All attendance modes" },
              ...sessionDemandReportExportQuerySchema.shape.attendanceMode.unwrap().options.map((value) => ({
                value,
                label: value === "physical" ? "In person" : "Remote",
              })),
            ],
          },
        },
        {
          header: "Registration",
          cell: (row) =>
            eventParticipationLink(slug, row.occurrenceId, row.admissionPolicy, row.accessPolicy).policyLabel,
        },
        ...(
          [
            ["preferences", "Favorites (interest)"],
            ["confirmed", "Confirmed"],
            ["pending", "Pending approval"],
            ["waitlisted", "Waitlisted"],
            ["occupied", "Occupied"],
          ] as const
        ).map(([key, header]) => ({
          header,
          align: "end" as const,
          width: "fit" as const,
          cell: (row: SessionDemandReportRow) => formatNumber(row[key]),
          sort: { asc: key, desc: `-${key}` },
        })),
        {
          header: "Session limit",
          align: "end",
          width: "fit",
          cell: (row) => (row.sessionCapacity === null ? "Not set" : formatNumber(row.sessionCapacity)),
          sort: { asc: "sessionCapacity", desc: "-sessionCapacity" },
        },
        {
          header: "Locations",
          cell: (row) =>
            row.locations.length
              ? row.locations.map((location) => (
                  <div key={location.id}>
                    {location.name}: {formatNumber(location.occupied)} occupied ·{" "}
                    {location.capacity === null ? "limit not set" : `${formatNumber(location.capacity)} capacity`}
                  </div>
                ))
              : "—",
        },
      ]}
    />
  );
}
