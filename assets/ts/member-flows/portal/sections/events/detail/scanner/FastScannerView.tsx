import type { EventScanResponse } from "../../../../../../../shared/schemas/event-participation-scanning";
import { Button } from "../../../../../../ui/Button";
import { IconCheckOutline, IconRemoveOutline, IconClock } from "../../../../../../components/icons/indicators";
import { IconInfoCircle } from "../../../../../../components/icons";
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
  cooldown,
  screenAwake = false,
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
  cooldown?: { remainingMs: number; durationMs: number; saving: boolean; skip: () => void };
  screenAwake?: boolean;
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
          <img
            class="pk-fast-scanner__brand"
            src="/img/logo-black.svg"
            alt="PKI Consortium"
            width="1256"
            height="324"
          />
          <strong>{context}</strong>
          <span>{pending} pending</span>
          <small>{screenAwake ? "Screen awake" : "Screen may turn off"}</small>
          {visibleUploadStatus && <small>{visibleUploadStatus}</small>}
        </div>
        <Button variant="secondary" onClick={onExit} autoFocus>
          Exit
        </Button>
      </header>
      <div class="pk-fast-scanner__feedback" role="status" aria-live="polite" aria-atomic="true">
        <span class="pk-fast-scanner__mark" aria-hidden="true">
          {outcome === "eligible" ? (
            <IconCheckOutline />
          ) : outcome === "denied" || outcome === "unknown" ? (
            <IconRemoveOutline />
          ) : outcome === "warning" ? (
            <IconInfoCircle />
          ) : (
            <IconClock />
          )}
        </span>
        <strong>{label}</strong>
        <p>{message}</p>
      </div>
      <div class="pk-fast-scanner__next">
        <div>
          <strong>
            {cooldown?.saving
              ? "Saving scan…"
              : cooldown && cooldown.remainingMs > 0
                ? `Next badge in ${(cooldown.remainingMs / 1000).toFixed(1)} seconds`
                : "Ready for the next badge"}
          </strong>
          {cooldown && cooldown.remainingMs > 0 && (
            <Button variant="secondary" onClick={cooldown.skip}>
              Scan next now
            </Button>
          )}
        </div>
        <progress
          max={cooldown?.durationMs || 600}
          value={
            cooldown?.saving ? undefined : cooldown ? Math.max(0, cooldown.durationMs - cooldown.remainingMs) : 600
          }
          aria-label="Next badge readiness"
        />
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
