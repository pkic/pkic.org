import { scannerAdmissionExceptionWarnings } from "../../../../assets/shared/schemas/event-scanner-admission";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";

/** Evaluate only the new attempt in its owning atomic command, after live eligibility is known. */
export function scannerAdmissionDecisionSql(action: EventScanRequest["action"], verifiedCaptureSql: string) {
  if (action !== "admission" && action !== "exception") return "NULL";
  const overrides = scannerAdmissionExceptionWarnings.map((reason) => `'${reason}'`).join(",");
  return `CASE
    WHEN reason IN ('revoked_badge','expired_badge','wrong_location') THEN 'refused'
    WHEN NOT (${verifiedCaptureSql}) OR outcome IN ('unverified','unknown') OR reason='verification_required' THEN 'unresolved'
    WHEN outcome='eligible' THEN 'allowed'
    ${action === "exception" ? `WHEN outcome='warning' AND reason IN (${overrides}) AND exception_reason IS NOT NULL THEN 'allowed'` : ""}
    ELSE 'refused' END`;
}
