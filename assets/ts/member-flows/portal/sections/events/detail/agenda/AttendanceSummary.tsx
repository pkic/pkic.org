import { useEffect } from "preact/hooks";
import { attendanceSummarySchema } from "../../../../../../../shared/schemas/event-attendance-reporting";
import type { EventContactRetention } from "../../../../../../../shared/schemas/event-contact-retention";
import { formatNumber } from "../../../../../../../shared/format-number";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { StatCard } from "../../../../../../ui/StatCard";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { DataTable } from "../../../../../../ui/DataTable";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Alert } from "../../../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../../../ui/Button";
export function AttendanceSummary({
  endpoint,
  onContactRetention,
  unsuccessfulHref,
  attendeesHref,
  diagnosticsHref,
  diagnostics = false,
}: {
  endpoint: string;
  onContactRetention?: (policy: EventContactRetention) => void;
  unsuccessfulHref?: string;
  attendeesHref?: string;
  diagnosticsHref?: string;
  diagnostics?: boolean;
}) {
  const { data, loading, error, reload } = useData(() => getJson(endpoint, attendanceSummarySchema), [endpoint]);
  useEffect(() => {
    if (data) onContactRetention?.(data.contactRetention);
  }, [data, onContactRetention]);
  if (error) return <ErrorAlert error={error} />;
  if (loading || !data) return <Spinner label="Loading attendance summary…" />;
  const metrics = [
    { label: "Enrolled scanner sessions", count: data.sync.scannerReconciliation.knownEpochs },
    { label: "Open scanner sessions", count: data.sync.scannerReconciliation.openEpochs },
    { label: "Finishing scanner sessions", count: data.sync.scannerReconciliation.closingEpochs },
    { label: "Closed scanner sessions", count: data.sync.scannerReconciliation.closedEpochs },
    { label: "Declared uploads still missing", count: data.sync.scannerReconciliation.missingDeclaredReceipts },
    { label: "Sessions with unknown queue size", count: data.sync.scannerReconciliation.unknownHighWaterEpochs },
    { label: "Attempts without upload receipts", count: data.sync.scannerReconciliation.untrackedAttempts },
    { label: "Historical offline grants", count: data.sync.knownGrants },
    { label: "Unclosed historical grants", count: data.sync.unclosedGrants },
    { label: "Unclosed historical devices", count: data.sync.unclosedDevices },
    { label: "Revoked historical grants still unclosed", count: data.sync.revokedUnclosedGrants },
    { label: "Expired historical grants still unclosed", count: data.sync.expiredUnclosedGrants },
    { label: "Unused historical authorizations", count: data.sync.heldUnspentSlots },
    { label: "Reconciled offline admissions", count: data.sync.reconciledAdmissions },
    { label: "Original observations", count: data.observed.originalObservations },
    { label: "Effective observations", count: data.observed.effectiveObservations },
    { label: "Excluded observations", count: data.observed.voidedObservations },
    { label: "Entry observations", count: data.observed.entryObservations },
    { label: "Reentry observations", count: data.observed.reentryObservations },
    { label: "Checkout observations", count: data.observed.checkoutObservations },
    { label: "Reviewed imports", count: data.observed.importedObservations },
    { label: "Historical offline-authorized observations", count: data.observed.offlineAuthorizedObservations },
    { label: "Provider-asserted virtual people", count: data.observed.providerAssertedVirtualPeople },
    { label: "Recognized scan attempts", count: data.attempts.recognized },
    { label: "Successful scans", count: data.attempts.successful },
    { label: "Not allowed", count: data.attempts.businessDenials },
    { label: "Warnings", count: data.attempts.warnings },
    { label: "Could not verify", count: data.attempts.unverified },
    { label: "Eligibility checks", count: data.attempts.checks },
    { label: "Admission attempts", count: data.attempts.admissions },
    { label: "Allowed admission decisions", count: data.attempts.admissionAllowed },
    { label: "Refused admission decisions", count: data.attempts.admissionRefused },
    { label: "Unresolved admission decisions", count: data.attempts.admissionUnresolved },
    { label: "Admission decisions not recorded", count: data.attempts.admissionUnknown },
    { label: "People with allowed admission", count: data.attempts.uniqueAllowedAdmissionPeople },
    { label: "Attendance captures", count: data.attempts.attendance },
    { label: "Reviewed exceptions", count: data.attempts.exceptions },
  ];
  return (
    <Panel aria-label={diagnostics ? "Attendance diagnostics" : "Attendance summary"}>
      <PanelHeader title={diagnostics ? "Attendance diagnostics" : "Attendance summary"}>
        <Button size="sm" onClick={() => void reload()}>
          Refresh summary
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        {diagnostics ? (
          <>
            <p>
              Reconciliation covers the entire event. These records do not establish complete reporting or presence
              duration. Device times are unverified; provider attendance is a source assertion.
            </p>
            <DescriptionList
              items={[
                {
                  term: "Upload status",
                  value:
                    data.sync.deviceBacklog === "complete"
                      ? "Uploads accounted for"
                      : data.sync.deviceBacklog === "pending"
                        ? "Uploads pending"
                        : "Upload coverage unknown",
                },
                {
                  term: "Last receipt",
                  value: data.sync.lastReceivedAt
                    ? formatDateTimeInZone(data.sync.lastReceivedAt, data.timeZone)
                    : "No receipts",
                },
                {
                  term: "Missing day context",
                  value: `${formatNumber(data.classification.missingObservations)} observations and ${formatNumber(data.classification.missingAttempts)} scan attempts`,
                },
                { term: "Recorded time zones", value: formatNumber(data.classification.capturedTimeZones) },
                { term: "Current schedule time zone", value: data.currentIntent.timeZone },
                {
                  term: "Checkout capture",
                  value: data.evidence.checkoutCaptureSupported ? "Supported" : "Not supported",
                },
                { term: "Report generated", value: formatDateTimeInZone(data.generatedAt, data.timeZone) },
              ]}
            />
            {data.classification.dayFilterExcludesMissing && (
              <p>Records without a recorded day are excluded from this day filter; their date has not been inferred.</p>
            )}
            {data.classification.mixedTimeZones && <p>Captures span multiple recorded time zones.</p>}
            {!data.currentIntent.dayIntervalAvailable && (
              <p>The current schedule cannot be assigned to this date in the event time zone.</p>
            )}
          </>
        ) : (
          <>
            <div class="pk-stat-row">
              <StatCard
                label="Observed people"
                value={formatNumber(data.observed.uniquePeople)}
                href={attendeesHref}
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
                note="includes attributed provider reports"
              />
              <StatCard
                label="Unsuccessful scans"
                value={formatNumber(data.attempts.unsuccessful)}
                href={unsuccessfulHref}
                tone={data.attempts.unsuccessful > 0 ? "warn" : "neutral"}
                note="includes warnings and scans that could not be verified"
              />
            </div>
            {data.sync.deviceBacklog !== "complete" && (
              <Alert tone="warn">
                Some uploads may still be outstanding. Attendance totals may change as scanners reconnect.
              </Alert>
            )}
            <p>
              Attendance is based on recorded observations and reviewed imports. Eligibility checks do not establish
              attendance or presence duration.
            </p>
            {data.classification.missingAttempts > 0 && (
              <p>
                {formatNumber(data.classification.missingAttempts)} scan attempts have no recorded day. Open the scan
                log to review them.
              </p>
            )}
            {diagnosticsHref && <ButtonLink href={diagnosticsHref}>View reconciliation diagnostics</ButtonLink>}
          </>
        )}
        <p>
          {data.contactRetention.state === "closed"
            ? "Attendee contact access has ended. Aggregate attendance remains available."
            : data.contactRetention.state === "unconfigured"
              ? "An attendee contact access deadline has not been configured."
              : `Contact access closes ${formatDateTimeInZone(data.contactRetention.contactUntil, data.timeZone)}.`}
        </p>
      </PanelBody>
      {diagnostics && (
        <PanelBody flush>
          <DataTable
            caption="Attendance reconciliation counts"
            narrowLayout="columns"
            rowKey={(row) => row.label}
            rows={metrics}
            columns={[
              { id: "label", header: "Metric", width: "primary", cell: (row) => row.label },
              {
                id: "count",
                header: "Count",
                align: "end",
                width: "fit",
                cell: (row) => (row.count === undefined ? "Unavailable" : formatNumber(row.count)),
              },
            ]}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
