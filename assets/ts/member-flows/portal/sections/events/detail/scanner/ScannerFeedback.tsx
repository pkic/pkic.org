import { formatNumber } from "../../../../../../../shared/format-number";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { scanFeedbackLabel, scanFeedbackOutcome, scanEligibilityLabel } from "./scan-stream";

export function ScannerFeedback({
  result,
  action,
  message,
  pending,
}: {
  result: EventScanResponse | null;
  action: EventScanRequest["action"];
  message: string;
  pending: number;
}) {
  const outcome = scanFeedbackOutcome(result, action);
  return (
    <div className={`pk-event-scanner pk-event-scanner--${outcome}`} role="status" aria-live="polite">
      <span className="pk-event-scanner__mark" aria-hidden="true">
        {outcome === "eligible" ? "✓" : outcome === "warning" ? "!" : result && outcome !== "unverified" ? "×" : "○"}
      </span>
      <strong>{scanFeedbackLabel(result, action)}</strong>
      {result?.admissionRecorded && result.admissionDecision && (
        <p>
          Eligibility: {scanEligibilityLabel(result)}. Attendance:{" "}
          {result.attendanceRecorded ? "Recorded" : "Not recorded"}.
        </p>
      )}
      <p>{message}</p>
      <p>{formatNumber(pending)} scans awaiting upload</p>
    </div>
  );
}
