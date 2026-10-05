import { EventAttendanceReport } from "./EventAttendanceReport";
import { useLiveBrowserSession } from "../../../../../../hooks/useLiveBrowserSession";
import { portalSession } from "../../../../state";
import { AttendanceImport } from "./AttendanceImport";
import { AttendanceEvidence } from "./AttendanceEvidence";
import { useState } from "preact/hooks";
import { Button } from "../../../../../../ui/Button";
import { SessionAttendancePeople } from "./SessionAttendancePeople";
import { attendanceReportSchema } from "../../../../../../../shared/schemas/event-participation-reporting";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
export function AttendanceReport({
  slug,
  timeZone,
  canCorrect = false,
  canImport = false,
  canRead = true,
}: {
  slug: string;
  timeZone: string;
  canCorrect?: boolean;
  canImport?: boolean;
  canRead?: boolean;
}) {
  const browser = useLiveBrowserSession();
  const operator = portalSession.value?.identity.id ?? "";
  const [epoch, setEpoch] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title="Observed attendance" />
        <PanelBody>
          <p>
            Attendance records come from attendance scans and attributable reviewed imports. Physical and virtual
            presence are reported separately. Eligibility checks and unsuccessful scans remain separate and do not count
            as attendance.
          </p>
        </PanelBody>
      </Panel>
      {canRead && <EventAttendanceReport key={`${slug}:${operator}`} slug={slug} timeZone={timeZone} epoch={epoch} />}
      {canImport && (
        <details>
          <summary>Import attendance</summary>
          <AttendanceImport
            canRead={canRead}
            slug={slug}
            timeZone={timeZone}
            onChanged={() => setEpoch((value) => value + 1)}
          />
        </details>
      )}
      {canRead && browser.live && (
        <ApiDataTable
          key={`${slug}:${operator}:${epoch}:${browser.epoch}`}
          clearDataOnReload
          retainDataOnError={false}
          endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance`}
          responseSchema={attendanceReportSchema}
          resolve={(value) => value.sessions}
          resolvePage={(value) => value.page}
          caption="Session attendance"
          rowKey={(row) => row.occurrenceId}
          detailRow={(row) =>
            expanded === row.occurrenceId ? (
              <div class="pk-stack">
                <SessionAttendancePeople slug={slug} occurrenceId={row.occurrenceId} timeZone={timeZone} />
                <AttendanceEvidence
                  slug={slug}
                  occurrenceId={row.occurrenceId}
                  timeZone={timeZone}
                  canCorrect={canCorrect}
                  onChanged={() => setEpoch((value) => value + 1)}
                />
              </div>
            ) : undefined
          }
          paginate
          urlState="attendance"
          searchPlaceholder="Search sessions…"
          columns={[
            { header: "Session", cell: (row) => row.title, sort: { asc: "title", desc: "-title" }, hideable: false },
            { header: "Attendees", cell: (row) => row.attendees, sort: { asc: "attendance", desc: "-attendance" } },
            { header: "Physical attendees", cell: (row) => row.physicalAttendees ?? 0 },
            { header: "Virtual attendees", cell: (row) => row.virtualAttendees ?? 0 },
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
      )}
    </div>
  );
}
