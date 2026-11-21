import { ScannerCollectionAttendee } from "./ScannerCollectionAttendee";
import { ScannerHelpTour } from "./ScannerHelpTour";
import { IconScannerHelp, IconScannerSound } from "../../../../../../components/icons/scanner-controls";
import type { ScannerSound } from "./scanner-audio-feedback";
import { scannerRole } from "./scanner-role";
import { ScannerTaskNavigation, useScannerTaskSwipe } from "./ScannerTaskNavigation";
import { ScannerModeIcon } from "./ScannerModeIcon";
import { ScannerPreparationStatus } from "./ScannerPreparationStatus";
import type { ComponentChildren, ComponentProps } from "preact";
import { scanFeedbackLabel, scanFeedbackOutcome } from "./scan-stream";
import "../../../../../../../design/tokens.scanner.generated.css";
import "../../../../../../../design/tokens.event.generated.css";
import { ScannerOperatorDrawer } from "./ScannerOperatorDrawer";
import { ScannerResultTrail, ScannerStatusIcon, useScannerStatus, type ScannerStatus } from "./ScannerStatus";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type {
  EventScanResponse,
  EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { Button } from "../../../../../../ui/Button";
import { scannerStartMessage } from "./ScannerCaptureControls";
import { ScannerLeadConfirmation, type LeadConfirmation } from "./ScannerLeadConfirmation";
import { CloseButton } from "../../../../../../ui/CloseButton";
import { IconTools } from "../../../../../../components/icons/indicators";
import { IconRefresh, IconVirtual, IconSearch, IconBulletList } from "../../../../../../components/icons";
import { scannerSwipeDirection, trapScannerDrawerTab } from "./scanner-gestures";
import "../../../../../../components/sign-in/Login.css";
import "./FastScannerView.css";
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
  manualLabel = "Find attendee or badge",
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
  onTourSound,
  helpOnStart = false,
  collection,
  needsAdvance = false,
  failed = false,
  onNextBadge,
  leadConsentConfirmed = false,
  leadConfirmation,
}: {
  collection?: ComponentProps<typeof ScannerCollectionAttendee> & { waiting: boolean; onNext: () => void };
  needsAdvance?: boolean;
  failed?: boolean;
  onNextBadge?: () => void;
  leadConsentConfirmed?: boolean;
  leadConfirmation?: LeadConfirmation | null;
  helpOnStart?: boolean;
  onTourSound?: (sound: ScannerSound) => void;
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
  manualLabel?: string;
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
  const [helpOpen, setHelpOpen] = useState(helpOnStart);
  const [tourDemo, setTourDemo] = useState<ScannerStatus>();
  const [tourResults, setTourResults] = useState<ScannerStatus[]>();
  const surface = useRef<HTMLDivElement>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const operatorPause = useRef(onOperatorPause);
  operatorPause.current = onOperatorPause;
  useLayoutEffect(() => {
    operatorPause.current?.(operatorOpen || helpOpen);
    return () => operatorPause.current?.(false);
  }, [operatorOpen, helpOpen]);
  const visualRole = scannerRole(mode, Boolean(preparation?.occurrenceId), purpose === "print");
  const navigation = useContext(ScannerTaskNavigation);
  const [gradientFrom, setGradientFrom] = useState(navigation?.gradientFrom);
  const taskSwipe = useScannerTaskSwipe(
    purpose === "print" ? "print" : mode === "checkout" ? "exit" : "entry",
    visualRole,
  );
  const taskSwitchBlocked =
    taskSwitchDisabled || cooldown?.saving || (!collection?.waiting && Boolean(cooldown?.remainingMs));
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
  const visibleStatus = helpOpen ? tourDemo : feedback.visible;
  const detail = visibleStatus?.detail || (helpOpen ? "" : message);
  const outcome = visibleStatus?.tone ?? (helpOpen ? "unverified" : scanFeedbackOutcome(result, mode));
  const readyLabel = collection
    ? "Ready for badge collection"
    : {
        entry:
          mode === "check"
            ? "Ready to check registration"
            : mode === "admission"
              ? "Ready for admission"
              : mode === "exception"
                ? "Ready to review admission"
                : "Ready for entry",
        exit: "Ready for exit",
        session: "Ready for session check-in",
        lead: "Ready to capture a lead",
        print: "Ready to scan and print",
      }[visualRole];
  const visibleUploadStatus =
    pending > 0 && uploadStatus === "All pending scans uploaded." ? "Uploading scans in the background…" : uploadStatus;
  let label = "Camera unavailable";
  if (result) label = scanFeedbackLabel(result, mode);
  else if (pending) label = "Verification pending";
  else if (cameraActive) label = "Ready to scan";
  let readiness = "Ready for the next badge";
  if (cooldown?.saving) readiness = "Checking badge…";
  else if (cooldown?.remainingMs) readiness = `Next badge in ${(cooldown.remainingMs / 1000).toFixed(1)} seconds`;
  if (needsAdvance) readiness = "Choose Next badge to continue";
  if (collection?.waiting) readiness = "Find this attendee’s badge, then choose Next attendee";
  const nextDisabled = collection?.saving || cooldown?.saving;
  return (
    <div
      ref={surface}
      class={`pk-login__backdrop pk-fast-scanner pk-scanner-viewport pk-fast-scanner--${outcome}${presentation === "embedded" ? " pk-fast-scanner--embedded" : ""}${visibleStatus ? " pk-fast-scanner--result" : ""}${manualEntry || recentScans ? " pk-fast-scanner--manual" : ""}`}
      data-fullscreen={presentation === "fullscreen" || undefined}
      data-status-pending={(visibleStatus?.tone === "unverified" && visibleStatus.record === false) || undefined}
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
        if (helpOpen) return;
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
        if (helpOpen || manualEntry || recentScans) {
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
        if (helpOpen || manualEntry || recentScans) {
          pointer.current = null;
          return;
        }
        const direction = scannerSwipeDirection(pointer.current, { x: event.clientX, y: event.clientY });
        pointer.current = null;
        if (
          (direction === "left" || direction === "right") &&
          presentation === "fullscreen" &&
          !operatorOpen &&
          !taskSwitchBlocked
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

        {!manualEntry && !recentScans && (
          <div class="pk-fast-scanner__feedback" role="status" aria-live="polite" aria-atomic="true">
            <div class="pk-fast-scanner__status" data-scanner-help="feedback">
              <span class="pk-fast-scanner__mark" aria-hidden="true" key={visibleStatus?.key ?? "ready"}>
                {visibleStatus ? (
                  <ScannerStatusIcon tone={visibleStatus.tone} />
                ) : (
                  <ScannerModeIcon action={mode} role={visualRole} />
                )}
              </span>
              <strong class="pk-fast-scanner__label" data-scanner-help="mode">
                {collection?.waiting && collection.showName && collection.loading
                  ? "Finding attendee…"
                  : (visibleStatus?.title ?? (cameraStarting ? "Starting camera…" : readyLabel))}
              </strong>
              {leadConfirmation && result?.outcome === "eligible" && !helpOpen && (
                <ScannerLeadConfirmation confirmation={leadConfirmation} />
              )}
              {collection?.waiting && !helpOpen && (
                <ScannerCollectionAttendee {...collection} saving={collection.saving || cooldown?.saving} />
              )}
              {detail &&
                detail !== "Ready to scan" &&
                detail !== scannerStartMessage(true, false, mode) &&
                detail !== visibleStatus?.title && <p class="pk-fast-scanner__message">{detail}</p>}
            </div>
            {purpose === "print" && !helpOpen && <div class="pk-fast-scanner__print-status">{statusActions}</div>}
            {!visibleStatus && context && !collection && <p class="pk-fast-scanner__context">{context}</p>}
          </div>
        )}
        {cameraError && !needsAdvance && !helpOpen && (
          <p class="pk-fast-scanner__message" role="status">
            {cameraError}
          </p>
        )}
        {manualEntry && <div class="pk-fast-scanner__manual">{manualEntry}</div>}
        {recentScans && <div class="pk-fast-scanner__manual">{recentScans}</div>}
        {!manualEntry && !recentScans && <ScannerResultTrail results={tourResults ?? feedback.history} />}
        {presentation === "fullscreen" && !manualEntry && !recentScans && taskSwipe.tasks.length > 1 && (
          <div
            class="pk-fast-scanner__task-swipe"
            data-scanner-help="switch"
            role="group"
            aria-disabled={taskSwitchBlocked || undefined}
            tabIndex={0}
            aria-label="Swipe left or right, or use arrow keys, to switch scanner"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                if (!operatorOpen && !taskSwitchBlocked) taskSwipe.move(event.key === "ArrowLeft" ? "left" : "right");
              }
            }}
          >
            {"← Swipe: "}
            {taskSwipe.tasks.map((task, index) => (
              <span key={task.key}>
                {index > 0 && " · "}
                <button
                  type="button"
                  class="pk-fast-scanner__task-link"
                  disabled={operatorOpen || taskSwitchBlocked}
                  aria-label={`Switch to ${task.label}`}
                  onClick={() => navigation?.onLaunch(task.key, visualRole)}
                >
                  {task.label}
                </button>
              </span>
            ))}
            {" →"}
          </div>
        )}
        <div class="pk-fast-scanner__actions">
          {collection?.waiting && !helpOpen && (
            <Button onClick={collection.onNext} disabled={nextDisabled} aria-label="Next attendee">
              Next
            </Button>
          )}
          {(needsAdvance || failed) &&
            !collection?.waiting &&
            !helpOpen &&
            !manualEntry &&
            !recentScans &&
            onNextBadge && (
              <Button onClick={onNextBadge} disabled={cooldown?.saving} aria-label="Next badge">
                Next
              </Button>
            )}
          {onPresentation && presentation === "embedded" && (
            <Button variant="secondary" onClick={onPresentation}>
              <IconFullscreen />
              Full screen
            </Button>
          )}
          {cameraActive && !collection?.waiting && !manualEntry && !recentScans && (
            <Button
              variant="secondary"
              icon
              data-scanner-help="camera"
              aria-label={preview ? "Hide preview" : "Show preview"}
              title={preview ? "Hide preview" : "Show preview"}
              aria-pressed={preview}
              onClick={onPreview}
            >
              <IconVirtual />
            </Button>
          )}
          {!cameraActive && !manualEntry && !recentScans && onCameraRetry && (
            <Button
              variant="secondary"
              icon
              data-scanner-help="camera"
              aria-label={cameraError ? "Retry camera" : "Start camera"}
              title={cameraError ? "Retry camera" : "Start camera"}
              loading={cameraStarting}
              disabled={mode === "lead" && !leadConsentConfirmed}
              onClick={onCameraRetry}
            >
              <IconVirtual />
            </Button>
          )}
          {onManual && !manualEntry && !recentScans && (
            <Button
              variant="secondary"
              icon
              data-scanner-help="find"
              aria-label={manualLabel}
              title={manualLabel}
              disabled={mode === "lead" && !leadConsentConfirmed}
              onClick={onManual}
            >
              <IconSearch />
            </Button>
          )}
          {onRecentScans && !recentScans && (
            <Button variant="secondary" icon aria-label="Recent scans" title="Recent scans" onClick={onRecentScans}>
              <IconBulletList />
            </Button>
          )}
          {recentScans && onReturnToScanning && (
            <Button variant="secondary" onClick={onReturnToScanning}>
              Return to scanning
            </Button>
          )}
          {onSound && (
            <Button
              variant="secondary"
              icon
              data-scanner-help="sound"
              aria-label={soundLabel}
              title={soundLabel}
              onClick={onSound}
            >
              <IconScannerSound />
            </Button>
          )}
          {presentation === "fullscreen" && (
            <Button
              variant="secondary"
              icon
              data-tour-trigger
              aria-label="Scanner help"
              title="Scanner help"
              aria-expanded={helpOpen}
              disabled={taskSwitchDisabled || cooldown?.saving}
              onClick={() => {
                if (!helpOpen) operatorPause.current?.(true);
                setHelpOpen(!helpOpen);
              }}
            >
              <IconScannerHelp />
            </Button>
          )}
          <CloseButton variant="secondary" data-scanner-help="close" label="Close scanner" onClick={onExit} />
        </div>
        <div class="pk-fast-scanner__next">
          <span class="pk-sr-only">{readiness}</span>
          <progress
            hidden={collection?.waiting || needsAdvance}
            max={cooldown?.durationMs || 600}
            value={
              cooldown?.saving ? undefined : cooldown ? Math.max(0, cooldown.durationMs - cooldown.remainingMs) : 600
            }
            aria-label="Next badge readiness"
          />
          <div class="pk-fast-scanner__tools">
            {connectionStatus}
            {!collection?.waiting && !needsAdvance && cooldown && cooldown.remainingMs > 0 && (
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
              data-scanner-help="options"
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
      {helpOpen && (
        <ScannerHelpTour
          scope={surface}
          role={visualRole}
          onDemo={setTourDemo}
          onSamples={setTourResults}
          onSound={onTourSound}
          onClose={() => {
            setHelpOpen(false);
            setTourDemo(undefined);
            setTourResults(undefined);
          }}
        />
      )}
      <ScannerOperatorDrawer
        sectionRef={drawer}
        id={drawerId}
        open={operatorOpen}
        onClose={() => setOperatorOpen(false)}
        operatorControls={operatorControls}
        context={context}
        currentResult={feedback.visible?.title ?? label}
        result={result}
        message={message}
        pending={pending}
        uploadStatus={visibleUploadStatus}
        screenAwake={screenAwake}
        readiness={readiness}
        preparation={preparation}
        cameraActive={cameraActive}
        canRecordAttendance={canRecordAttendance}
        exceptionRequest={exceptionRequest}
        onExceptionConfirm={onExceptionConfirm}
        mode={mode}
        preview={preview}
        onPreview={onPreview}
        manualEntry={manualEntry}
        recentScans={recentScans}
        collectionWaiting={collection?.waiting}
        cooldown={cooldown}
        onExit={onExit}
      />
    </div>
  );
}
