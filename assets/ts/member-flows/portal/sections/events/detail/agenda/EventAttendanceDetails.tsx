import { admissionDecisionLabel } from "../scanner/scan-stream";
import {
  attendanceAttemptsResponseSchema,
  attendanceReasonsResponseSchema,
  eventAttendancePeopleResponseSchema,
} from "../../../../../../../shared/schemas/event-attendance-reporting";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { useState } from "preact/hooks";
import { Button } from "../../../../../../ui/Button";
import { scanActionSchema } from "../../../../../../../shared/schemas/event-participation-scanning";
import {
  attendancePeopleExportQuerySchema,
  attendanceAttemptsExportQuerySchema,
} from "../../../../../../../shared/schemas/event-attendance-exports";
import { ButtonLink } from "../../../../../../ui/Button";

function exportQuery(query: Readonly<Record<string, string>>) {
  const { limit: _limit, offset: _offset, ...filters } = query;
  return filters;
}
export function EventAttendanceDetails({
  base,
  params,
  timeZone,
  allowIdentityViews = true,
}: {
  base: string;
  params: Record<string, string>;
  timeZone: string;
  allowIdentityViews?: boolean;
}) {
  const [view, setView] = useState<"people" | "attempts" | "reasons">("people");
  const visibleView = allowIdentityViews ? view : "reasons";
  return (
    <div class="pk-stack">
      <div class="pk-cluster" role="group" aria-label="Attendance evidence views">
        {(["people", "attempts", "reasons"] as const)
          .filter((value) => allowIdentityViews || value === "reasons")
          .map((value) => (
            <Button size="sm" aria-pressed={visibleView === value} onClick={() => setView(value)}>
              {value === "people"
                ? "Observed people"
                : value === "attempts"
                  ? "Scan attempts"
                  : "Reasons and exceptions"}
            </Button>
          ))}
      </div>
      {visibleView === "people" && (
        <ApiDataTable
          key={`people:${JSON.stringify(params)}`}
          endpoint={`${base}/people`}
          params={params}
          responseSchema={eventAttendancePeopleResponseSchema}
          resolve={(value) => value.attendees}
          resolvePage={(value) => value.page}
          paginate
          caption="Observed event attendees"
          rowKey={(row) => row.userId}
          searchPlaceholder="Search attendee names…"
          initialSort="name"
          clearDataOnReload
          retainDataOnError={false}
          toolbar={(_actions, query) => (
            <ButtonLink
              href={`${base}/people/exports?${new URLSearchParams(attendancePeopleExportQuerySchema.parse(exportQuery(query)))}`}
            >
              Export observed people
            </ButtonLink>
          )}
          columns={[
            {
              header: "Attendee",
              cell: (row) => row.displayName ?? "Attendee",
              sort: { asc: "name", desc: "-name" },
              hideable: false,
            },
            { header: "Physical observations", cell: (row) => row.physicalObservations },
            { header: "Virtual observations", cell: (row) => row.virtualObservations },
            { header: "Reserved sessions", cell: (row) => row.reservedSessions },
            { header: "Saved sessions", cell: (row) => row.savedSessions },
            { header: "Pending approvals", cell: (row) => row.approvalPendingSessions, defaultHidden: true },
            {
              header: `First observed (${timeZone})`,
              cell: (row) => formatDateTimeInZone(row.firstObservedAt, timeZone),
              sort: { asc: "firstObservedAt", desc: "-firstObservedAt" },
              defaultHidden: true,
            },
            {
              header: `Last observed (${timeZone})`,
              cell: (row) => formatDateTimeInZone(row.lastObservedAt, timeZone),
              defaultHidden: true,
            },
            {
              header: "Recorded context",
              cell: (row) =>
                `${row.capturedTimeZones} timezone(s); ${row.missingContextObservations} observations missing context`,
              defaultHidden: true,
            },
            { header: "Reviewed imports", cell: (row) => row.importedObservations, defaultHidden: true },
            {
              header: "Provider assertions",
              cell: (row) => row.providerAssertedVirtualObservations,
              defaultHidden: true,
            },
          ]}
        />
      )}
      {visibleView === "attempts" && (
        <ApiDataTable
          key={`attempts:${JSON.stringify(params)}`}
          endpoint={`${base}/attempts`}
          params={params}
          responseSchema={attendanceAttemptsResponseSchema}
          resolve={(value) => value.attempts}
          resolvePage={(value) => value.page}
          paginate
          caption="Recognized scan attempts"
          rowKey={(row) => row.id}
          initialSort="-receivedAt"
          searchPlaceholder="Search reasons…"
          clearDataOnReload
          retainDataOnError={false}
          toolbar={(_actions, query) => (
            <ButtonLink
              href={`${base}/attempts/exports?${new URLSearchParams(attendanceAttemptsExportQuerySchema.parse(exportQuery(query)))}`}
            >
              Export scan attempts
            </ButtonLink>
          )}
          columns={[
            { header: "Attendee", cell: (row) => row.displayName ?? "Attendee", hideable: false },
            {
              header: "Action",
              cell: (row) => row.action,
              filter: {
                param: "action",
                options: [
                  { value: "", label: "All actions" },
                  ...scanActionSchema.options.map((value) => ({ value, label: value })),
                ],
              },
            },
            { header: "Outcome", cell: (row) => row.outcome },
            { header: "Admission decision", cell: (row) => admissionDecisionLabel(row.admissionDecision) },
            {
              header: "Reason",
              cell: (row) => row.reason,
              filter: { param: "reason", text: { placeholder: "Exact reason code" } },
            },
            {
              header: "Recorded day",
              cell: (row) =>
                row.captureContext.state === "captured"
                  ? `${row.captureContext.dayDate} · ${row.captureContext.timeZone} · ${row.captureContext.source}`
                  : "Day context missing (UTC time shown)",
            },
            { header: "Exception explanation", cell: (row) => row.exceptionReason ?? "—" },
            {
              header: "Received",
              cell: (row) => formatDateTimeInZone(row.receivedAt, timeZone),
              sort: { asc: "receivedAt", desc: "-receivedAt" },
            },
            {
              header: "Device time (unverified)",
              cell: (row) =>
                formatDateTimeInZone(
                  row.observedAt,
                  row.captureContext.state === "captured" ? row.captureContext.timeZone : "UTC",
                ),
              sort: { asc: "observedAt", desc: "-observedAt" },
              defaultHidden: true,
            },
            {
              header: "Offline reconciled",
              cell: (row) => (row.offlineReconciled ? "Yes" : "No"),
              defaultHidden: true,
            },
            { header: "Operator ID", cell: (row) => row.operatorUserId, defaultHidden: true },
            { header: "Device ID", cell: (row) => row.deviceId, defaultHidden: true },
          ]}
        />
      )}
      {visibleView === "reasons" && (
        <ApiDataTable
          key={`reasons:${JSON.stringify(params)}`}
          endpoint={`${base}/reasons`}
          params={params}
          responseSchema={attendanceReasonsResponseSchema}
          resolve={(value) => value.reasons}
          resolvePage={(value) => value.page}
          paginate
          caption="Scan reason breakdown"
          rowKey={(row) => row.key}
          initialSort="-count"
          searchPlaceholder="Search reasons and exceptions…"
          clearDataOnReload
          retainDataOnError={false}
          columns={[
            { header: "Reason", cell: (row) => row.reason, sort: { asc: "reason", desc: "-reason" }, hideable: false },
            { header: "Action", cell: (row) => row.action },
            { header: "Outcome", cell: (row) => row.outcome },
            { header: "Exception explanation", cell: (row) => row.exceptionReason ?? "—" },
            { header: "Attempts", cell: (row) => row.count, sort: { asc: "count", desc: "-count" } },
          ]}
        />
      )}
      <p>
        Saved sessions and reservations express intent, not observed attendance. Provider assertions and device
        timestamps do not verify presence or duration.
      </p>
    </div>
  );
}
