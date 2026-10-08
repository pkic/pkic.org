import { getJson } from "../../../../../../shared/api-client";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import { admissionDecisionLabel } from "../scanner/scan-stream";
import {
  attendanceAttemptsResponseSchema,
  attendanceScopeQuerySchema,
  attendanceReasonsResponseSchema,
  eventAttendancePeopleResponseSchema,
} from "../../../../../../../shared/schemas/event-attendance-reporting";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { scanActionSchema, scanReasonSchema } from "../../../../../../../shared/schemas/event-participation-scanning";
import {
  attendancePeopleExportQuerySchema,
  attendanceAttemptsExportQuerySchema,
} from "../../../../../../../shared/schemas/event-attendance-exports";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { attendanceAttemptSchema } from "../../../../../../../shared/schemas/event-attendance-reporting";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { RowActions } from "../../../../../../ui/RowActions";
import { formatNumber } from "../../../../../../../shared/format-number";
import { attendanceOutcomeLabel, attendanceReasonLabel, attendanceActionLabel } from "./attendance-navigation";

function exportQuery(query: Readonly<Record<string, string>>) {
  const { limit: _limit, offset: _offset, ...filters } = query;
  return filters;
}
export function EventAttendanceDetails({
  base,
  params,
  timeZone,
  allowIdentityViews = true,
  view = "people",
  allScansHref,
}: {
  base: string;
  params: Record<string, string>;
  timeZone: string;
  allowIdentityViews?: boolean;
  view?: "people" | "attempts" | "reasons";
  allScansHref?: string;
}) {
  const [selected, setSelected] = useState<z.infer<typeof attendanceAttemptSchema> | null>(null);
  const scope = JSON.stringify(params);
  const [identityExportReady, setIdentityExportReady] = useState(false);
  useEffect(() => setIdentityExportReady(false), [base, scope, view, allowIdentityViews]);
  const loadIdentityRows: CollectionLoader = useCallback(async (url, signal, schema) => {
    setIdentityExportReady(false);
    try {
      const result = await getJson(url, schema, { signal });
      if (!signal.aborted) setIdentityExportReady(true);
      return result;
    } catch (error) {
      if (!signal.aborted) setIdentityExportReady(false);
      throw error;
    }
  }, []);
  useEffect(() => setSelected(null), [base, scope, view, allowIdentityViews]);
  const visibleView = allowIdentityViews ? view : "reasons";
  if (selected && allowIdentityViews)
    return (
      <Panel>
        <PanelHeader title="Scan details" />
        <PanelBody class="pk-stack">
          <Button onClick={() => setSelected(null)}>Back to scan log</Button>
          <DescriptionList
            items={[
              { term: "Attendee", value: selected.displayName ?? "Attendee" },
              { term: "Outcome", value: attendanceOutcomeLabel(selected.outcome) },
              { term: "Explanation", value: attendanceReasonLabel(selected.reason) },
              { term: "Action", value: attendanceActionLabel(selected.action) },
              { term: "Scope", value: selected.occurrenceId ? "Session" : "Event entrance" },
              { term: "Admission decision", value: admissionDecisionLabel(selected.admissionDecision) },
              {
                term: "Recorded day",
                value:
                  selected.captureContext.state === "captured"
                    ? `${selected.captureContext.dayDate} · ${selected.captureContext.timeZone}`
                    : "No day was recorded; none has been inferred.",
              },
              { term: "Received", value: formatDateTimeInZone(selected.receivedAt, timeZone) },
              {
                term: "Device time (unverified)",
                value: formatDateTimeInZone(
                  selected.observedAt,
                  selected.captureContext.state === "captured" ? selected.captureContext.timeZone : "UTC",
                ),
              },
              { term: "Upload status", value: "Received by the server" },
              {
                term: "Offline reconciliation",
                value: selected.offlineReconciled ? "Reconciled" : "No historical offline reconciliation",
              },
              ...(selected.exceptionReason ? [{ term: "Exception explanation", value: selected.exceptionReason }] : []),
            ]}
          />
        </PanelBody>
      </Panel>
    );
  return (
    <div class="pk-stack">
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
          urlState="attendance-attendees"
          rowKey={(row) => row.userId}
          searchPlaceholder="Search attendee names…"
          initialSort="name"
          clearDataOnReload
          retainDataOnError={false}
          load={loadIdentityRows}
          toolbar={(_actions, query) =>
            identityExportReady && (
              <ButtonLink
                href={`${base}/people/exports?${new URLSearchParams(attendancePeopleExportQuerySchema.parse(exportQuery(query)))}`}
              >
                Export observed people
              </ButtonLink>
            )
          }
          columns={[
            {
              header: "Attendee",
              cell: (row) => row.displayName ?? "Attendee",
              sort: { asc: "name", desc: "-name" },
              hideable: false,
            },
            {
              header: "Physical observations",
              filter: {
                param: "attendanceMode",
                options: [
                  { value: "", label: "All attendance modes" },
                  ...attendanceScopeQuerySchema.shape.attendanceMode.unwrap().options.map((value) => ({
                    value,
                    label: value === "physical" ? "Physical" : "Virtual",
                  })),
                ],
              },
              align: "end",
              width: "fit",
              cell: (row) => formatNumber(row.physicalObservations),
            },
            {
              header: "Virtual observations",
              align: "end",
              width: "fit",
              cell: (row) => formatNumber(row.virtualObservations),
            },
            {
              header: "Reserved sessions",
              align: "end",
              width: "fit",
              cell: (row) => formatNumber(row.reservedSessions),
            },
            { header: "Saved sessions", align: "end", width: "fit", cell: (row) => formatNumber(row.savedSessions) },
            {
              header: "Pending approvals",
              align: "end",
              width: "fit",
              cell: (row) => formatNumber(row.approvalPendingSessions),
              defaultHidden: true,
            },
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
                `${formatNumber(row.capturedTimeZones)} time zone(s); ${formatNumber(row.missingContextObservations)} observations missing context`,
              defaultHidden: true,
            },
            {
              header: "Reviewed imports",
              align: "end",
              width: "fit",
              cell: (row) => formatNumber(row.importedObservations),
              defaultHidden: true,
            },
            {
              header: "Provider assertions",
              align: "end",
              width: "fit",
              cell: (row) => formatNumber(row.providerAssertedVirtualObservations),
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
          caption={params.unsuccessful === "true" ? "Unsuccessful scans" : "Scan log"}
          rowKey={(row) => row.id}
          urlState={params.unsuccessful === "true" ? "attendance-failures" : "attendance-log"}
          initialSort="-receivedAt"
          searchPlaceholder="Search reasons…"
          clearDataOnReload
          retainDataOnError={false}
          load={loadIdentityRows}
          toolbar={(_actions, query) => (
            <div class="pk-cluster">
              {params.unsuccessful === "true" && allScansHref && (
                <ButtonLink href={allScansHref}>View all scans</ButtonLink>
              )}
              {identityExportReady && (
                <ButtonLink
                  href={`${base}/attempts/exports?${new URLSearchParams(Object.entries(attendanceAttemptsExportQuerySchema.parse(exportQuery(query))).map(([key, value]) => [key, String(value)]))}`}
                >
                  Export scan log
                </ButtonLink>
              )}
            </div>
          )}
          columns={[
            { header: "Attendee", cell: (row) => row.displayName ?? "Attendee", width: "primary", hideable: false },
            {
              header: "Action",
              width: "fit",
              cell: (row) => attendanceActionLabel(row.action),
              filter: {
                param: "action",
                options: [
                  { value: "", label: "All actions" },
                  ...scanActionSchema.options.map((value) => ({ value, label: attendanceActionLabel(value) })),
                ],
              },
            },
            { header: "Outcome", width: "fit", cell: (row) => attendanceOutcomeLabel(row.outcome) },
            {
              header: "Session",
              cell: (row) => (row.occurrenceId ? "Session scan" : "Event entrance"),
              defaultHidden: true,
            },
            {
              header: "Admission decision",
              cell: (row) => admissionDecisionLabel(row.admissionDecision),
              defaultHidden: true,
            },
            {
              header: "Reason",
              width: "compact",
              cell: (row) => <span title={attendanceReasonLabel(row.reason)}>{row.reason.replaceAll("_", " ")}</span>,
              filter: {
                param: "reason",
                options: [
                  { value: "", label: "All reasons" },
                  ...scanReasonSchema.options.map((value) => ({ value, label: attendanceReasonLabel(value) })),
                ],
              },
            },
            {
              header: "Recorded day",
              defaultHidden: true,
              filter: { param: "dayDate", text: { placeholder: "Event day: YYYY-MM-DD" } },
              cell: (row) =>
                row.captureContext.state === "captured"
                  ? `${row.captureContext.dayDate} · ${row.captureContext.timeZone} · ${row.captureContext.source}`
                  : "Day context missing (UTC time shown)",
            },
            { header: "Exception explanation", cell: (row) => row.exceptionReason ?? "—", defaultHidden: true },
            {
              header: "Received",
              width: "fit",
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
            {
              header: "Actions",
              width: "fit",
              hideable: false,
              cell: (row) => (
                <RowActions
                  subject={row.displayName ?? "Scan"}
                  actions={[{ id: "details", label: "View scan", onSelect: () => setSelected(row) }]}
                />
              ),
            },
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
          load={loadIdentityRows}
          columns={[
            { header: "Reason", cell: (row) => row.reason, sort: { asc: "reason", desc: "-reason" }, hideable: false },
            { header: "Action", cell: (row) => row.action },
            { header: "Outcome", cell: (row) => row.outcome },
            { header: "Exception explanation", cell: (row) => row.exceptionReason ?? "—" },
            {
              header: "Attempts",
              align: "end",
              width: "fit",
              cell: (row) => formatNumber(row.count),
              sort: { asc: "count", desc: "-count" },
            },
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
