import { ScannerPreparationStatus } from "./ScannerPreparationStatus";
import type { ComponentProps } from "preact";
import { scanFeedbackLabel, scanFeedbackOutcome, scanEligibilityLabel } from "./scan-stream";
import "../../../../../../../design/tokens.scanner.generated.css";
import { ScannerExceptionReview } from "./ScannerExceptionReview";
import { scannerActionLabel } from "./ScannerModeSelect";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type {
  EventScanResponse,
  EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { Button } from "../../../../../../ui/Button";
import {
  IconCheckOutline,
  IconRemoveOutline,
  IconClock,
  IconTools,
  IconRefreshOutline,
} from "../../../../../../components/icons/indicators";
import { IconInfoCircle } from "../../../../../../components/icons";
import { scannerSwipeDirection, trapScannerDrawerTab } from "./scanner-gestures";
import "../../../../shell/Login.css";
import "./FastScannerView.css";

export function FastScannerView({
  canRecordAttendance = true,
  context,
  mode = "check",
  result,
  pending,
  message,
  cameraActive,
  cameraStarting = false,
  cameraError = "",
  onCameraRetry,
  onManual,
  onRecentScans,
  preview,
  onPreview,
  onExit,
  uploadStatus,
  cooldown,
  screenAwake = false,
  exceptionRequest,
  onExceptionConfirm,
  onOperatorPause,
  preparation,
}: {
  canRecordAttendance?: boolean;
  context: string;
  mode?: EventScanRequest["action"];
  result: EventScanResponse | null;
  pending: number;
  message: string;
  cameraActive: boolean;
  cameraStarting?: boolean;
  cameraError?: string;
  onCameraRetry?: () => void;
  onManual?: () => void;
  onRecentScans?: () => void;
  preview: boolean;
  onPreview: () => void;
  onExit: () => void;
  uploadStatus?: string;
  cooldown?: { remainingMs: number; durationMs: number; saving: boolean; skip: () => void };
  screenAwake?: boolean;
  exceptionRequest?: EventScanRequest | null;
  onExceptionConfirm?: (request: EventScanRequest) => Promise<void>;
  onOperatorPause?: (paused: boolean) => void;
  preparation?: ComponentProps<typeof ScannerPreparationStatus>;
}) {
  const [review, setReview] = useState<EventScanRequest | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  useLayoutEffect(() => {
    onOperatorPause?.(operatorOpen);
    if (!operatorOpen) setReview(null);
    return () => onOperatorPause?.(false);
  }, [operatorOpen]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    drawer = useRef<HTMLElement>(null);
  const drawerId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    if (operatorOpen) drawer.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    else trigger.current?.focus({ preventScroll: true });
  }, [operatorOpen]);
  const outcome = scanFeedbackOutcome(result, mode);
  const visibleUploadStatus =
    pending > 0 && uploadStatus === "All pending scans uploaded." ? "Uploading scans in the background…" : uploadStatus;
  const label = result
    ? scanFeedbackLabel(result, mode)
    : pending
      ? "Verification pending"
      : cameraActive
        ? "Ready to scan"
        : "Camera unavailable";
  const readiness = cooldown?.saving
    ? "Saving scan…"
    : cooldown && cooldown.remainingMs > 0
      ? `Next badge in ${(cooldown.remainingMs / 1000).toFixed(1)} seconds`
      : "Ready for the next badge";
  return (
    <div
      class={`pk-login__backdrop pk-fast-scanner pk-fast-scanner--${outcome}${result ? " pk-fast-scanner--result" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Continuous badge scanner"
      onKeyDown={(event) => {
        if (!operatorOpen) {
          const stage = event.currentTarget.querySelector<HTMLElement>(".pk-fast-scanner__stage");
          if (stage) trapScannerDrawerTab(stage, event);
        }
      }}
      onPointerDown={(event) => {
        if (event.target instanceof Node && drawer.current?.contains(event.target)) {
          pointer.current = null;
          return;
        }
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const direction = scannerSwipeDirection(pointer.current, { x: event.clientX, y: event.clientY });
        pointer.current = null;
        if (direction === "up") setOperatorOpen(true);
        else if (direction === "down") setOperatorOpen(false);
      }}
      onPointerCancel={() => {
        pointer.current = null;
      }}
    >
      <span class="pk-fast-scanner__tone pk-fast-scanner__tone--ok" aria-hidden="true" />
      <span class="pk-fast-scanner__tone pk-fast-scanner__tone--attention" aria-hidden="true" />
      <div class="pk-fast-scanner__stage" aria-hidden={operatorOpen ? true : undefined}>
        <img class="pk-fast-scanner__brand" src="/img/logo.svg" alt="PKI Consortium" width="1256" height="324" />
        <p class="pk-fast-scanner__context">
          {context} · {scannerActionLabel(mode)}
        </p>
        <div class="pk-fast-scanner__feedback" role="status" aria-live="polite" aria-atomic="true">
          <span class="pk-fast-scanner__mark" aria-hidden="true" key={result?.operationId ?? "ready"}>
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
          <strong class="pk-fast-scanner__label">
            {result
              ? label
              : cameraStarting
                ? "Starting camera…"
                : cameraActive
                  ? "Ready to scan"
                  : "Use a reader or paste a code"}
          </strong>
          {message && <p class="pk-fast-scanner__message">{message}</p>}
        </div>
        {cameraError && (
          <p class="pk-fast-scanner__message" role="status">
            {cameraError}
          </p>
        )}
        <div class="pk-fast-scanner__actions">
          {cameraActive && (
            <Button variant="secondary" onClick={onPreview}>
              {preview ? "Hide preview" : "Show preview"}
            </Button>
          )}
          {!cameraActive && onCameraRetry && (
            <Button variant="secondary" loading={cameraStarting} onClick={onCameraRetry}>
              Retry camera
            </Button>
          )}
          {onManual && (
            <Button variant="secondary" onClick={onManual}>
              Enter or paste code
            </Button>
          )}
          {onRecentScans && (
            <Button variant="secondary" onClick={onRecentScans}>
              Recent scans
            </Button>
          )}
          <Button variant="secondary" onClick={onExit}>
            Exit
          </Button>
        </div>
        <div class="pk-fast-scanner__next">
          <span class="pk-sr-only">{readiness}</span>
          <progress
            max={cooldown?.durationMs || 600}
            value={
              cooldown?.saving ? undefined : cooldown ? Math.max(0, cooldown.durationMs - cooldown.remainingMs) : 600
            }
            aria-label="Next badge readiness"
          />
          <div class="pk-fast-scanner__tools">
            {cooldown && cooldown.remainingMs > 0 && (
              <button
                type="button"
                class="pk-fast-scanner__tool"
                tabIndex={operatorOpen ? -1 : 0}
                aria-label="Scan next now"
                onClick={cooldown.skip}
              >
                <IconRefreshOutline />
              </button>
            )}
            <button
              ref={trigger}
              type="button"
              class="pk-fast-scanner__tool"
              tabIndex={operatorOpen ? -1 : 0}
              aria-label="Operator controls"
              aria-expanded={operatorOpen}
              aria-controls={drawerId}
              onClick={() => setOperatorOpen(true)}
            >
              <IconTools />
            </button>
          </div>
        </div>
      </div>
      <section
        ref={drawer}
        id={drawerId}
        class="pk-fast-scanner__drawer"
        hidden={!operatorOpen}
        role="dialog"
        aria-modal="true"
        aria-label="Scanner operator controls"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            setOperatorOpen(false);
          } else trapScannerDrawerTab(event.currentTarget, event);
        }}
      >
        <header>
          <h2>Scanner operator controls</h2>
          <Button variant="ghost" onClick={() => setOperatorOpen(false)} aria-label="Close operator controls">
            <IconRemoveOutline />
          </Button>
        </header>
        <dl>
          <div>
            <dt>Scanning scope</dt>
            <dd>{context}</dd>
          </div>
          <div>
            <dt>Current result</dt>
            <dd>{label}</dd>
          </div>
          {result?.admissionRecorded && result.admissionDecision && (
            <>
              <div>
                <dt>Eligibility</dt>
                <dd>{scanEligibilityLabel(result)}</dd>
              </div>
              <div>
                <dt>Attendance</dt>
                <dd>{result.attendanceRecorded ? "Recorded" : "Not recorded"}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Details</dt>
            <dd>{message}</dd>
          </div>
          <div>
            <dt>Uploads</dt>
            <dd>
              {pending} pending{visibleUploadStatus && <small>{visibleUploadStatus}</small>}
            </dd>
          </div>
          <div>
            <dt>Screen</dt>
            <dd>{screenAwake ? "Screen awake" : "Screen may turn off"}</dd>
          </div>
          <div>
            <dt>Next badge</dt>
            <dd>{readiness}</dd>
          </div>
        </dl>
        {preparation && (
          <section aria-label="Preparation details">
            <h3>Preparation details</h3>
            <ScannerPreparationStatus {...preparation} />
          </section>
        )}
        <p>
          {cameraActive
            ? "Camera scanning continuously."
            : "Use a connected badge reader here, or exit to retry the camera."}
        </p>
        {review && onExceptionConfirm && (
          <ScannerExceptionReview
            canRecordAttendance={canRecordAttendance}
            request={review}
            onConfirm={onExceptionConfirm}
            onCancel={() => {
              setReview(null);
              setOperatorOpen(false);
            }}
          />
        )}
        {!review &&
          exceptionRequest &&
          mode !== "lead" &&
          mode !== "checkout" &&
          onExceptionConfirm &&
          result &&
          result.outcome !== "eligible" &&
          result.outcome !== "unknown" &&
          result.reason !== "revoked_badge" &&
          result.reason !== "expired_badge" && (
            <Button variant="secondary" onClick={() => setReview(exceptionRequest)}>
              Review admission exception
            </Button>
          )}
        <div class="pk-cluster">
          {cameraActive && (
            <Button variant="secondary" onClick={onPreview}>
              {preview ? "Hide preview" : "Show preview"}
            </Button>
          )}
          {cooldown && cooldown.remainingMs > 0 && (
            <Button variant="secondary" onClick={cooldown.skip}>
              Scan next now
            </Button>
          )}
          <Button variant="secondary" onClick={() => setOperatorOpen(false)}>
            Return to scanning
          </Button>
          <Button onClick={onExit}>Exit</Button>
        </div>
      </section>
    </div>
  );
}
