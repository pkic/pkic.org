import type { EventScanResponse } from "../../../../../../../shared/schemas/event-participation-scanning";
import { Button } from "../../../../../../ui/Button";
import "./FastScannerView.css";

export function FastScannerView({
  context,
  result,
  pending,
  message,
  cameraActive,
  preview,
  onPreview,
  onExit,
  uploadStatus,
}: {
  context: string;
  result: EventScanResponse | null;
  pending: number;
  message: string;
  cameraActive: boolean;
  preview: boolean;
  onPreview: () => void;
  onExit: () => void;
  uploadStatus?: string;
}) {
  const outcome = result?.outcome ?? "unverified";
  const visibleUploadStatus =
    pending > 0 && uploadStatus === "All pending scans uploaded." ? "Uploading scans in the background…" : uploadStatus;
  const label =
    outcome === "eligible"
      ? result?.attendanceRecorded
        ? "Attendance recorded"
        : "Eligibility verified"
      : outcome === "warning"
        ? "Registration required"
        : outcome === "unknown"
          ? "Unknown badge"
          : outcome === "denied"
            ? "Do not admit"
            : pending
              ? "Verification pending"
              : cameraActive
                ? "Ready to scan"
                : "Camera unavailable";
  return (
    <div
      class={`pk-fast-scanner pk-fast-scanner--${outcome}`}
      role="dialog"
      aria-modal="true"
      aria-label="Continuous badge scanner"
    >
      <header class="pk-fast-scanner__header">
        <div>
          <strong>{context}</strong>
          <span>{pending} pending</span>
          {visibleUploadStatus && <small>{visibleUploadStatus}</small>}
        </div>
        <Button variant="secondary" onClick={onExit} autoFocus>
          Exit
        </Button>
      </header>
      <div class="pk-fast-scanner__feedback" role="status" aria-live="polite" aria-atomic="true">
        <span class="pk-fast-scanner__mark" aria-hidden="true">
          {outcome === "eligible"
            ? "✓"
            : outcome === "warning"
              ? "!"
              : outcome === "denied" || outcome === "unknown"
                ? "×"
                : "○"}
        </span>
        <strong>{label}</strong>
        <p>{message}</p>
      </div>
      <footer class="pk-fast-scanner__footer">
        <span>
          {cameraActive
            ? "Hold each badge in front of the camera"
            : "Use a connected badge reader here, or exit to retry the camera"}
        </span>
        {cameraActive && (
          <Button variant="ghost" onClick={onPreview}>
            {preview ? "Hide preview" : "Show preview"}
          </Button>
        )}
      </footer>
    </div>
  );
}
