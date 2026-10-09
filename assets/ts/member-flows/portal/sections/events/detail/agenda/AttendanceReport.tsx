import { useState } from "preact/hooks";
import { EventAttendanceReport } from "./EventAttendanceReport";
import { useLiveBrowserSession } from "../../../../../../hooks/useLiveBrowserSession";
import { portalSession } from "../../../../state";
import { AttendanceImport } from "./AttendanceImport";
import { AttendanceEvidence } from "./AttendanceEvidence";
import { SessionAttendancePeople } from "./SessionAttendancePeople";
import { attendanceReportSchema } from "../../../../../../../shared/schemas/event-participation-reporting";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Tabs } from "../../../../../../ui/Tabs";
import { RowActions } from "../../../../../../ui/RowActions";
import { Alert } from "../../../../../../ui/Alert";
import { formatNumber } from "../../../../../../../shared/format-number";
import { attendancePath } from "./attendance-navigation";
export function AttendanceReport({
  slug,
  timeZone,
  canCorrect = false,
  canImport = false,
  canRead = true,
  basePath = `/events/${slug}/attendance`,
  section,
  detailId,
  detailTab,
}: {
  slug: string;
  timeZone: string;
  canCorrect?: boolean;
  canImport?: boolean;
  canRead?: boolean;
  basePath?: string;
  section?: string;
  detailId?: string;
  detailTab?: string;
}) {
  const browser = useLiveBrowserSession();
  const operator = portalSession.value?.identity.id ?? "";
  const [epoch, setEpoch] = useState(0);
  const sections = [
    ...(canRead
      ? [
          { id: "summary", label: "Summary" },
          { id: "attendees", label: "Attendees" },
          { id: "sessions", label: "Sessions" },
          { id: "scan-log", label: "Scan log" },
        ]
      : []),
    ...(canRead || canImport ? [{ id: "imports", label: "Imports" }] : []),
  ];
  const view =
    section === "diagnostics"
      ? "diagnostics"
      : sections.some((item) => item.id === section)
        ? section!
        : sections[0]?.id;
  const changed = () => setEpoch((value) => value + 1);
  if (!view || (view === "diagnostics" && !canRead))
    return <Alert tone="info">Attendance is not available to your current account.</Alert>;
  return (
    <div class="pk-stack">
      <Tabs
        items={sections.map((item) => ({ ...item, href: attendancePath(basePath, item.id) }))}
        activeId={view === "diagnostics" ? "summary" : view}
        label="Attendance sections"
      />
      {!browser.live ? (
        <Alert tone="info">Reconnect and keep this screen visible to view attendance.</Alert>
      ) : (
        <div key={`${slug}:${operator}:${browser.epoch}`}>
          {(view === "summary" || view === "attendees" || view === "scan-log" || view === "diagnostics") && canRead && (
            <EventAttendanceReport
              slug={slug}
              timeZone={timeZone}
              epoch={epoch}
              view={view}
              basePath={basePath}
              unsuccessful={view === "scan-log" && detailId === "unsuccessful"}
              reasons={view === "diagnostics" && detailId === "reasons"}
            />
          )}
          {view === "imports" && (
            <AttendanceImport
              key={detailId ?? "list"}
              slug={slug}
              timeZone={timeZone}
              onChanged={changed}
              canRead={canRead}
              canImport={canImport}
              creating={detailId === "new"}
              basePath={basePath}
            />
          )}
          {view === "sessions" &&
            canRead &&
            (detailId ? (
              <div class="pk-stack">
                <Tabs
                  label="Session attendance sections"
                  activeId={detailTab === "evidence" ? "evidence" : "attendees"}
                  items={[
                    {
                      id: "attendees",
                      label: "Attendees",
                      href: `${attendancePath(basePath, "sessions", detailId)}/attendees`,
                    },
                    {
                      id: "evidence",
                      label: "Observations",
                      href: `${attendancePath(basePath, "sessions", detailId)}/evidence`,
                    },
                  ]}
                />
                {detailTab === "evidence" ? (
                  <AttendanceEvidence
                    key={detailId}
                    slug={slug}
                    occurrenceId={detailId}
                    timeZone={timeZone}
                    canCorrect={canCorrect}
                    onChanged={changed}
                  />
                ) : (
                  <SessionAttendancePeople slug={slug} occurrenceId={detailId} timeZone={timeZone} />
                )}
              </div>
            ) : (
              <ApiDataTable
                key={epoch}
                clearDataOnReload
                retainDataOnError={false}
                endpoint={`/api/v1/events/${encodeURIComponent(slug)}/attendance`}
                responseSchema={attendanceReportSchema}
                resolve={(value) => value.sessions}
                resolvePage={(value) => value.page}
                caption="Session attendance"
                rowKey={(row) => row.occurrenceId}
                paginate
                urlState="attendance-sessions"
                searchPlaceholder="Search sessions…"
                columns={[
                  {
                    header: "Session",
                    cell: (row) => <a href={attendancePath(basePath, "sessions", row.occurrenceId)}>{row.title}</a>,
                    sort: { asc: "title", desc: "-title" },
                    hideable: false,
                  },
                  {
                    header: "Attendees",
                    cell: (row) => formatNumber(row.attendees),
                    sort: { asc: "attendance", desc: "-attendance" },
                    align: "end",
                    width: "fit",
                  },
                  {
                    header: "Physical attendees",
                    cell: (row) => formatNumber(row.physicalAttendees ?? 0),
                    align: "end",
                    width: "fit",
                  },
                  {
                    header: "Virtual attendees",
                    cell: (row) => formatNumber(row.virtualAttendees ?? 0),
                    align: "end",
                    width: "fit",
                  },
                  { header: "Scan attempts", cell: (row) => formatNumber(row.scans), align: "end", width: "fit" },
                  {
                    header: "Unsuccessful scans",
                    cell: (row) => formatNumber(row.unsuccessful),
                    align: "end",
                    width: "fit",
                  },
                  {
                    header: "Actions",
                    cell: (row) => (
                      <RowActions
                        subject={row.title}
                        actions={[
                          {
                            id: "attendees",
                            label: "View attendees",
                            href: attendancePath(basePath, "sessions", row.occurrenceId),
                          },
                          {
                            id: "observations",
                            label: "Review observations",
                            href: `${attendancePath(basePath, "sessions", row.occurrenceId)}/evidence`,
                          },
                        ]}
                      />
                    ),
                    hideable: false,
                    width: "fit",
                  },
                ]}
              />
            ))}
        </div>
      )}
    </div>
  );
}
