import { scannerRole } from "./scanner-role";
import { ScannerTaskNavigation, useScannerTaskSwipe } from "./ScannerTaskNavigation";
import { ScannerModeIcon } from "./ScannerModeIcon";
import { ScannerPreparationStatus } from "./ScannerPreparationStatus";
import type { ComponentChildren, ComponentProps } from "preact";
import { scanFeedbackLabel, scanFeedbackOutcome, scanEligibilityLabel } from "./scan-stream";
import "../../../../../../../design/tokens.scanner.generated.css";
import "../../../../../../../design/tokens.event.generated.css";
import { ScannerExceptionReview } from "./ScannerExceptionReview";
import { ScannerResultTrail, ScannerStatusIcon, useScannerStatus, type ScannerStatus } from "./ScannerStatus";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type {
  EventScanResponse,
  EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { Button } from "../../../../../../ui/Button";
import { CloseButton } from "../../../../../../ui/CloseButton";
import { IconTools } from "../../../../../../components/icons/indicators";
import { IconRefresh, IconVideo } from "../../../../../../components/icons";
import { scannerSwipeDirection, trapScannerDrawerTab } from "./scanner-gestures";
import "../../../../shell/Login.css";
import "./FastScannerView.css";
import { HeadingOutline } from "../../../../../../ui/HeadingOutline";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { IconFullscreen } from "../../../../../../components/icons/app-navigation";

export function FastScannerView({
  presentation = "fullscreen",
  taskSwitchDisabled = false,
  purpose = "scan",
  onPresentation,
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
  manualEntry,
  onRecentScans,
  recentScans,
  onReturnToScanning,
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
  lastResult,
  connectionStatus,
  status,
  statusActions,
  operatorControls,
  soundLabel,
  onSound,
}: {
  presentation?: "embedded" | "fullscreen";
  taskSwitchDisabled?: boolean;
  purpose?: "scan" | "print";
  onPresentation?: () => void;
  lastResult?: EventScanResponse | null;
  connectionStatus?: ComponentChildren;
  status?: ScannerStatus;
  statusActions?: ComponentChildren;
  operatorControls?: ComponentChildren;
  soundLabel?: string;
  onSound?: () => void;
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
  manualEntry?: ComponentChildren;
  onRecentScans?: () => void;
  recentScans?: ComponentChildren;
  onReturnToScanning?: () => void;
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
  const operatorPause = useRef(onOperatorPause);
  operatorPause.current = onOperatorPause;
  useLayoutEffect(() => {
    operatorPause.current?.(operatorOpen);
    if (!operatorOpen) setReview(null);
    return () => operatorPause.current?.(false);
  }, [operatorOpen]);
  const visualRole = scannerRole(mode, Boolean(preparation?.occurrenceId), purpose === "print");
  const navigation = useContext(ScannerTaskNavigation);
  const [gradientFrom, setGradientFrom] = useState(navigation?.gradientFrom);
  const taskSwipe = useScannerTaskSwipe(
    purpose === "print" ? "print" : mode === "checkout" ? "exit" : "entry",
    visualRole,
  );
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
  const scanStatus = (scan: EventScanResponse | null | undefined): ScannerStatus | undefined =>
    scan
      ? {
          key: scan.operationId,
          tone: scanFeedbackOutcome(scan, mode),
          title: scanFeedbackLabel(scan, mode),
        }
      : undefined;
  const feedback = useScannerStatus(status ?? scanStatus(result), scanStatus(lastResult));
  const outcome = feedback.visible?.tone ?? scanFeedbackOutcome(result, mode);
  const readyLabel = {
    entry: "Ready for entry",
    exit: "Ready for exit",
    session: "Ready for session check-in",
    lead: "Ready to capture a lead",
    print: "Ready to scan and print",
  }[visualRole];
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
      class={`pk-login__backdrop pk-fast-scanner pk-scanner-viewport pk-fast-scanner--${outcome}${presentation === "embedded" ? " pk-fast-scanner--embedded" : ""}${feedback.visible ? " pk-fast-scanner--result" : ""}${manualEntry || recentScans ? " pk-fast-scanner--manual" : ""}`}
      data-fullscreen={presentation === "fullscreen" || undefined}
      data-scanner-role={visualRole}
      data-gradient-from={gradientFrom}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "pk-scanner-field-turn")
          setGradientFrom(undefined);
      }}
      role={presentation === "fullscreen" ? "dialog" : "region"}
      aria-modal={presentation === "fullscreen" ? "true" : undefined}
      aria-label={purpose === "print" ? "Badge printing scanner" : "Continuous badge scanner"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onExit();
          return;
        }
        if (presentation !== "fullscreen") return;
        if (!operatorOpen) {
          const stage = event.currentTarget.querySelector<HTMLElement>(".pk-fast-scanner__stage");
          if (stage) trapScannerDrawerTab(stage, event);
        }
      }}
      onPointerDown={(event) => {
        if (manualEntry || recentScans) {
          pointer.current = null;
          return;
        }
        if (
          event.target instanceof Node &&
          (drawer.current?.contains(event.target) ||
            (event.target instanceof Element && event.target.closest("form,button,a,input,select,textarea")))
        ) {
          pointer.current = null;
          return;
        }
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        if (manualEntry || recentScans) {
          pointer.current = null;
          return;
        }
        const direction = scannerSwipeDirection(pointer.current, { x: event.clientX, y: event.clientY });
        pointer.current = null;
        if (
          (direction === "left" || direction === "right") &&
          presentation === "fullscreen" &&
          !operatorOpen &&
          !taskSwitchDisabled &&
          !cooldown?.saving &&
          !cooldown?.remainingMs
        )
          taskSwipe.move(direction);
        else if (direction === "up") setOperatorOpen(true);
        else if (direction === "down") setOperatorOpen(false);
      }}
      onPointerCancel={() => {
        pointer.current = null;
      }}
    >
      <span class="pk-fast-scanner__tone pk-fast-scanner__tone--ok" aria-hidden="true" />
      <span class="pk-fast-scanner__tone pk-fast-scanner__tone--warning" aria-hidden="true" />
      <span class="pk-fast-scanner__tone pk-fast-scanner__tone--error" aria-hidden="true" />
      <div class="pk-fast-scanner__stage" aria-hidden={operatorOpen ? true : undefined}>
        <img class="pk-fast-scanner__brand" src="/img/logo.svg" alt="PKI Consortium" width="1256" height="324" />
        {connectionStatus}

        {!manualEntry && !recentScans && (
          <div class="pk-fast-scanner__feedback" role="status" aria-live="polite" aria-atomic="true">
            <span class="pk-fast-scanner__mark" aria-hidden="true" key={feedback.visible?.key ?? "ready"}>
              {feedback.visible ? (
                <ScannerStatusIcon tone={feedback.visible.tone} />
              ) : (
                <ScannerModeIcon action={mode} role={visualRole} />
              )}
            </span>
            <strong class="pk-fast-scanner__label">
              {feedback.visible?.title ?? (cameraStarting ? "Starting camera…" : readyLabel)}
            </strong>
            {(feedback.visible?.detail || message) && (
              <p class="pk-fast-scanner__message">{feedback.visible?.detail || message}</p>
            )}
            {purpose === "print" && <div class="pk-fast-scanner__print-status">{statusActions}</div>}
            {!feedback.visible && context && <p class="pk-fast-scanner__context">{context}</p>}
          </div>
        )}
        {cameraError && (
          <p class="pk-fast-scanner__message" role="status">
            {cameraError}
          </p>
        )}
        {manualEntry && <div class="pk-fast-scanner__manual">{manualEntry}</div>}
        {recentScans && <div class="pk-fast-scanner__manual">{recentScans}</div>}
        {!manualEntry && !recentScans && <ScannerResultTrail results={feedback.history} />}
        {presentation === "fullscreen" && !manualEntry && !recentScans && taskSwipe.tasks.length > 1 && (
          <p
            class="pk-fast-scanner__task-swipe"
            role="group"
            aria-disabled={taskSwitchDisabled || cooldown?.saving || Boolean(cooldown?.remainingMs) || undefined}
            tabIndex={0}
            aria-label="Swipe left or right, or use arrow keys, to switch scanner"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                if (!operatorOpen && !taskSwitchDisabled && !cooldown?.saving && !cooldown?.remainingMs)
                  taskSwipe.move(event.key === "ArrowLeft" ? "left" : "right");
              }
            }}
          >
            ← Swipe: {taskSwipe.tasks.map((task) => task.label).join(" · ")} →
          </p>
        )}
        <div class="pk-fast-scanner__actions">
          {onPresentation && presentation === "embedded" && (
            <Button variant="secondary" onClick={onPresentation}>
              <IconFullscreen />
              Full screen
            </Button>
          )}
          {cameraActive && !manualEntry && !recentScans && (
            <Button
              variant="secondary"
              icon
              aria-label={preview ? "Hide preview" : "Show preview"}
              title={preview ? "Hide preview" : "Show preview"}
              aria-pressed={preview}
              onClick={onPreview}
            >
              <IconVideo />
            </Button>
          )}
          {!cameraActive && !manualEntry && !recentScans && onCameraRetry && (
            <Button variant="secondary" loading={cameraStarting} onClick={onCameraRetry}>
              {cameraError ? "Retry camera" : "Start camera"}
            </Button>
          )}
          {onManual && !manualEntry && !recentScans && (
            <Button variant="secondary" onClick={onManual}>
              Find attendee or badge
            </Button>
          )}
          {onRecentScans && !recentScans && (
            <Button variant="secondary" onClick={onRecentScans}>
              Recent scans
            </Button>
          )}
          {recentScans && onReturnToScanning && (
            <Button variant="secondary" onClick={onReturnToScanning}>
              Return to scanning
            </Button>
          )}
          {onSound && (
            <Button variant="secondary" onClick={onSound}>
              {soundLabel}
            </Button>
          )}
          <CloseButton overMedia label="Close scanner" onClick={onExit} />
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
                <IconRefresh />
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
        {/* The drawer is a modal dialog, so its outline restarts at its own <h2> title. */}
        <HeadingOutline titleLevel={2}>
          <header>
            <SectionHeading level={2}>Scanner operator controls</SectionHeading>
            <CloseButton label="Close operator controls" onClick={() => setOperatorOpen(false)} />
          </header>
          {operatorControls}
          <dl>
            <div>
              <dt>Scanning scope</dt>
              <dd>{context}</dd>
            </div>
            <div>
              <dt>Current result</dt>
              <dd>{feedback.visible?.title ?? label}</dd>
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
              <SectionHeading level={3}>Preparation details</SectionHeading>
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
            {cameraActive && !manualEntry && !recentScans && (
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
            <Button onClick={onExit}>Close scanner</Button>
          </div>
        </HeadingOutline>
      </section>
    </div>
  );
}
