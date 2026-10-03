import { useState } from "preact/hooks";
import { Button } from "../../../../../../ui/Button";
import { SessionAttendancePeople } from "./SessionAttendancePeople";
import { attendanceReportSchema } from "../../../../../../../shared/schemas/event-participation-reporting";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
export function AttendanceReport({ slug, timeZone }: { slug: string; timeZone: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title="Observed attendance" />
        <PanelBody>
          <p>
            Attendance records come from successful attendance scans. Eligibility checks and unsuccessful scans remain
            separate and do not count as attendance.
          </p>
        </PanelBody>
      </Panel>
      <ApiDataTable
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance`}
        responseSchema={attendanceReportSchema}
        resolve={(value) => value.sessions}
        resolvePage={(value) => value.page}
        caption="Session attendance"
        rowKey={(row) => row.occurrenceId}
        detailRow={(row) =>
          expanded === row.occurrenceId ? (
            <SessionAttendancePeople slug={slug} occurrenceId={row.occurrenceId} timeZone={timeZone} />
          ) : undefined
        }
        paginate
        urlState="attendance"
        searchPlaceholder="Search sessions…"
        columns={[
          { header: "Session", cell: (row) => row.title, sort: { asc: "title", desc: "-title" }, hideable: false },
          { header: "Attendees", cell: (row) => row.attendees, sort: { asc: "attendance", desc: "-attendance" } },
          { header: "Scan attempts", cell: (row) => row.scans },
          { header: "Unsuccessful scans", cell: (row) => row.unsuccessful },
          {
            header: "Details",
            cell: (row) => (
              <Button
                size="sm"
                aria-expanded={expanded === row.occurrenceId}
                aria-label={`View attendees for ${row.title}`}
                onClick={() => setExpanded(expanded === row.occurrenceId ? null : row.occurrenceId)}
              >
                {expanded === row.occurrenceId ? "Hide attendees" : "View attendees"}
              </Button>
            ),
            hideable: false,
          },
        ]}
      />
    </div>
  );
}
