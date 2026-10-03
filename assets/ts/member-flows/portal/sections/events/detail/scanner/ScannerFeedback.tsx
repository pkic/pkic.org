import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
const scanOutcomeLabels = {
  eligible: "Eligible",
  warning: "Registration required",
  denied: "Admission denied",
  unknown: "Unknown badge",
  unverified: "Verification required",
};

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
  return (
    <div
      className={`pk-event-scanner pk-event-scanner--${result?.outcome ?? "unverified"}`}
      role="status"
      aria-live="polite"
    >
      <span className="pk-event-scanner__mark" aria-hidden="true">
        {result?.outcome === "eligible"
          ? "✓"
          : result?.outcome === "warning"
            ? "!"
            : result && result.outcome !== "unverified"
              ? "×"
              : "○"}
      </span>
      <strong>
        {result
          ? result.outcome === "eligible" && action === "lead"
            ? "Lead captured"
            : result.outcome === "eligible" && result.attendanceRecorded
              ? "Attendance recorded"
              : result.reason === "consent_required"
                ? "Consent required"
                : scanOutcomeLabels[result.outcome]
          : "Ready to scan"}
      </strong>
      <p>{message}</p>
      <p>{pending} scans awaiting upload</p>
    </div>
  );
}
