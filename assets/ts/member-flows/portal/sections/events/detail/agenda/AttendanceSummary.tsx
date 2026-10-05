import { attendanceSummarySchema } from "../../../../../../../shared/schemas/event-attendance-reporting";
import { formatNumber } from "../../../../../../../shared/format-number";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { StatCard } from "../../../../../../ui/StatCard";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { DataTable, type DataTableColumn } from "../../../../../../ui/DataTable";
import { CollapsiblePanel } from "../../../../../../ui/CollapsiblePanel";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Badge } from "../../../../../../ui/Badge";
import { Alert } from "../../../../../../ui/Alert";
import { Button } from "../../../../../../ui/Button";
import { useEffect } from "preact/hooks";
import type { EventContactRetention } from "../../../../../../../shared/schemas/event-contact-retention";
type EvidenceMetric = { label: string; count: number | undefined };
const metricColumns: DataTableColumn<EvidenceMetric>[] = [
  { id: "label", header: "Metric", width: "primary", cell: (row) => row.label },
  {
    id: "count",
    header: "Count",
    align: "end",
    width: "fit",
    cell: (row) => (row.count === undefined ? "Unavailable" : formatNumber(row.count)),
  },
];
export function AttendanceSummary({
  endpoint,
  onContactRetention,
}: {
  endpoint: string;
  onContactRetention?: (policy: EventContactRetention) => void;
}) {
  const { data, loading, error, reload } = useData(() => getJson(endpoint, attendanceSummarySchema), [endpoint]);
  useEffect(() => {
    if (data) onContactRetention?.(data.contactRetention);
  }, [data, onContactRetention]);
  if (error) return <ErrorAlert error={error} />;
  if (loading || !data) return <Spinner label="Loading attendance summary…" />;
  const syncTone =
    data.sync.deviceBacklog === "complete" ? "ok" : data.sync.deviceBacklog === "pending" ? "warn" : "neutral";
  const syncLabel =
    data.sync.deviceBacklog === "complete"
      ? "Uploads accounted for"
      : data.sync.deviceBacklog === "pending"
        ? "Uploads pending"
        : "Backlog unknown";
  return (
    <Panel aria-label="Attendance summary">
      <PanelHeader title="Attendance summary">
        <Button size="sm" onClick={() => void reload()}>
          Refresh summary
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <div class="pk-stat-row">
          <StatCard
            label="Observed people"
            value={formatNumber(data.observed.uniquePeople)}
            note="distinct people across attendance modes"
          />
          <StatCard
            label="Physical attendance"
            value={formatNumber(data.observed.physicalPeople)}
            note="observed people"
          />
          <StatCard
            label="Virtual attendance"
            value={formatNumber(data.observed.virtualPeople)}
            note="includes attributed provider assertions"
          />
          <StatCard
            label="Unsuccessful scans"
            value={formatNumber(data.attempts.unsuccessful)}
            note="recognized IDs; not attendance"
            tone={data.attempts.unsuccessful > 0 ? "warn" : "neutral"}
          />
        </div>
        <Panel aria-label="Scanner synchronization">
          <PanelHeader title="Scanner synchronization">
            <Badge tone={syncTone}>{syncLabel}</Badge>
          </PanelHeader>
          <PanelBody class="pk-stack">
            <Alert tone={syncTone === "neutral" ? "info" : syncTone}>
              {data.sync.deviceBacklog === "complete"
                ? "All enrolled scanner sessions and offline admission grants have closed with their uploads accounted for."
                : data.sync.deviceBacklog === "pending"
                  ? "Scanner synchronization is pending. Some scanner sessions, uploads, or offline admission grants remain open."
                  : "Device backlog is unknown. This event does not have complete scanner enrollment coverage."}{" "}
              Report completeness and presence duration are not established. Device clocks are unverified; provider
              attendance is a source assertion.
            </Alert>
            <p>
              Scanner synchronization covers the entire event, including when this report is filtered by day or session.
            </p>
            <p>
              {data.contactRetention.state === "closed"
                ? "Attendee and sponsor contact access has closed under the event retention policy. Aggregate attendance remains available."
                : data.contactRetention.state === "unconfigured"
                  ? "An event contact access deadline has not been configured. Raw evidence retention is a separate policy."
                  : `Contact access closes ${formatDateTimeInZone(data.contactRetention.contactUntil, data.timeZone)}. Raw evidence retention is a separate policy.`}
            </p>
            <p>Current reservations and preferences use {data.currentIntent.timeZone} calendar boundaries.</p>
            {(data.classification.missingObservations > 0 || data.classification.missingAttempts > 0) && (
              <p>
                {formatNumber(data.classification.missingObservations)} observations and{" "}
                {formatNumber(data.classification.missingAttempts)} attempts in this event, session and attendance mode
                have no recorded day context.
                {data.classification.dayFilterExcludesMissing
                  ? " These records are excluded from the selected day; their day is unknown."
                  : " These records are included in totals for this scope."}
              </p>
            )}
            {data.classification.mixedTimeZones && (
              <p>Captures span multiple recorded timezones; no single UTC day window represents this population.</p>
            )}
            {!data.currentIntent.dayIntervalAvailable && (
              <p>Current schedule intent cannot be assigned to this date in the current event timezone.</p>
            )}
            <DataTable
              narrowLayout="columns"
              caption="Scanner synchronization counts"
              columns={metricColumns}
              rowKey={(row) => row.label}
              rows={[
                { label: "Enrolled scanner sessions", count: data.sync.scannerReconciliation.knownEpochs },
                { label: "Open scanner sessions", count: data.sync.scannerReconciliation.openEpochs },
                { label: "Finishing scanner sessions", count: data.sync.scannerReconciliation.closingEpochs },
                { label: "Closed scanner sessions", count: data.sync.scannerReconciliation.closedEpochs },
                {
                  label: "Declared uploads still missing",
                  count: data.sync.scannerReconciliation.missingDeclaredReceipts,
                },
                {
                  label: "Sessions with an unknown queue size",
                  count: data.sync.scannerReconciliation.unknownHighWaterEpochs,
                },
                { label: "Attempts without upload receipts", count: data.sync.scannerReconciliation.untrackedAttempts },
                { label: "Known offline grants", count: data.sync.knownGrants },
                { label: "Unclosed grants", count: data.sync.unclosedGrants },
                { label: "Unclosed grant devices", count: data.sync.unclosedDevices },
                { label: "Revoked grants, still unclosed", count: data.sync.revokedUnclosedGrants },
                { label: "Expired grants, still unclosed", count: data.sync.expiredUnclosedGrants },
                { label: "Reserved offline slots not spent", count: data.sync.heldUnspentSlots },
              ]}
            />
            <DescriptionList
              density="compact"
              items={[
                {
                  term: "Last received",
                  value: data.sync.lastReceivedAt
                    ? formatDateTimeInZone(data.sync.lastReceivedAt, data.timeZone)
                    : "No receipts",
                },
              ]}
            />
          </PanelBody>
        </Panel>
        <CollapsiblePanel title="Observation and scan evidence">
          <DataTable
            narrowLayout="columns"
            caption="Observation and scan evidence counts"
            columns={metricColumns}
            rowKey={(row) => row.label}
            rows={[
              { label: "Original observations", count: data.observed.originalObservations },
              { label: "Effective observations", count: data.observed.effectiveObservations },
              { label: "Voided observations", count: data.observed.voidedObservations },
              { label: "Entry observations", count: data.observed.entryObservations },
              { label: "Reentry observations", count: data.observed.reentryObservations },
              { label: "Checkout observations", count: data.observed.checkoutObservations },
              { label: "Reviewed imports", count: data.observed.importedObservations },
              { label: "Offline authorized observations", count: data.observed.offlineAuthorizedObservations },
              { label: "Provider asserted virtual people", count: data.observed.providerAssertedVirtualPeople },
              { label: "Recognized attempts", count: data.attempts.recognized },
              { label: "Successful attempts", count: data.attempts.successful },
              { label: "Business denials", count: data.attempts.businessDenials },
              { label: "Warnings", count: data.attempts.warnings },
              { label: "Unverified attempts", count: data.attempts.unverified },
              { label: "Eligibility checks", count: data.attempts.checks },
              { label: "Admission attempts", count: data.attempts.admissions },
              { label: "Allowed admission decisions", count: data.attempts.admissionAllowed },
              { label: "Refused admission decisions", count: data.attempts.admissionRefused },
              { label: "Unresolved admission decisions", count: data.attempts.admissionUnresolved },
              { label: "Admission decisions not recorded", count: data.attempts.admissionUnknown },
              { label: "People with allowed admission", count: data.attempts.uniqueAllowedAdmissionPeople },
              { label: "Attendance captures", count: data.attempts.attendance },
              { label: "Exceptions", count: data.attempts.exceptions },
              { label: "Reconciled offline admissions", count: data.sync.reconciledAdmissions },
            ]}
          />
          <PanelBody>
            <DescriptionList
              density="compact"
              items={[
                {
                  term: "Checkout capture",
                  value: data.evidence.checkoutCaptureSupported ? "Supported" : "Not supported",
                },
                { term: "Report generated", value: formatDateTimeInZone(data.generatedAt, data.timeZone) },
              ]}
            />
          </PanelBody>
        </CollapsiblePanel>
      </PanelBody>
    </Panel>
  );
}
