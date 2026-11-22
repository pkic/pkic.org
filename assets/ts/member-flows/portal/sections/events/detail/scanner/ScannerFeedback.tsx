import type { ScannerStatus } from "./ScannerStatus";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { scanFeedbackLabel, scanFeedbackOutcome, scanEligibilityLabel } from "./scan-stream";
import { ScannerLeadConfirmation, type LeadConfirmation } from "./ScannerLeadConfirmation";

export function ScannerFeedback({
  result,
  action,
  message,
  compact = false,
  status,
  leadConfirmation,
}: {
  result: EventScanResponse | null;
  action: EventScanRequest["action"];
  message: string;
  pending: number;
  compact?: boolean;
  status?: ScannerStatus;
  leadConfirmation?: LeadConfirmation | null;
}) {
  const outcome = status?.tone ?? scanFeedbackOutcome(result, action);
  return (
    <div
      className={`pk-event-scanner pk-event-scanner--${outcome}${compact ? " pk-event-scanner--compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      {!compact && (
        <span className="pk-event-scanner__mark" aria-hidden="true">
          {outcome === "eligible" ? "✓" : outcome === "warning" ? "!" : result && outcome !== "unverified" ? "×" : "○"}
        </span>
      )}
      <strong>{status?.title ?? scanFeedbackLabel(result, action)}</strong>
      {leadConfirmation && result?.outcome === "eligible" && (
        <ScannerLeadConfirmation confirmation={leadConfirmation} />
      )}
      {result?.admissionRecorded && result.admissionDecision && (
        <p>
          Eligibility: {scanEligibilityLabel(result)}. Attendance:{" "}
          {result.attendanceRecorded ? "Recorded" : "Not recorded"}.
        </p>
      )}
      {message !== status?.title && <p>{message}</p>}
    </div>
  );
}
