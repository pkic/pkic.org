import type { ComponentChildren, ComponentProps, Ref } from "preact";
import { useEffect, useState } from "preact/hooks";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { Button } from "../../../../../../ui/Button";
import { CloseButton } from "../../../../../../ui/CloseButton";
import { HeadingOutline } from "../../../../../../ui/HeadingOutline";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { scanEligibilityLabel } from "./scan-stream";
import { trapScannerDrawerTab } from "./scanner-gestures";
import { ScannerExceptionReview } from "./ScannerExceptionReview";
import { ScannerPreparationStatus } from "./ScannerPreparationStatus";

/** Detailed status and recovery actions stay in the operator drawer, away from the camera view. */
export function ScannerOperatorDrawer({
  sectionRef,
  id,
  open,
  onClose,
  operatorControls,
  context,
  currentResult,
  result,
  message,
  pending,
  uploadStatus,
  screenAwake,
  readiness,
  preparation,
  cameraActive,
  canRecordAttendance,
  exceptionRequest,
  onExceptionConfirm,
  mode,
  preview,
  onPreview,
  manualEntry,
  recentScans,
  collectionWaiting,
  cooldown,
  onExit,
}: {
  sectionRef: Ref<HTMLElement>;
  id: string;
  open: boolean;
  onClose: () => void;
  operatorControls?: ComponentChildren;
  context: string;
  currentResult: string;
  result: EventScanResponse | null;
  message: string;
  pending: number;
  uploadStatus?: string;
  screenAwake: boolean;
  readiness: string;
  preparation?: ComponentProps<typeof ScannerPreparationStatus>;
  cameraActive: boolean;
  canRecordAttendance: boolean;
  exceptionRequest?: EventScanRequest | null;
  onExceptionConfirm?: (request: EventScanRequest) => Promise<void>;
  mode: EventScanRequest["action"];
  preview: boolean;
  onPreview: () => void;
  manualEntry?: ComponentChildren;
  recentScans?: ComponentChildren;
  collectionWaiting?: boolean;
  cooldown?: { remainingMs: number; skip: () => void };
  onExit: () => void;
}) {
  const [review, setReview] = useState<EventScanRequest | null>(null);
  useEffect(() => {
    if (!open) setReview(null);
  }, [open]);
  return (
    <section
      ref={sectionRef}
      id={id}
      class="pk-fast-scanner__drawer"
      hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-label="Scanner operator controls"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else trapScannerDrawerTab(event.currentTarget, event);
      }}
    >
      <HeadingOutline titleLevel={2}>
        <header>
          <SectionHeading level={2}>Scanner operator controls</SectionHeading>
          <CloseButton label="Close operator controls" onClick={onClose} />
        </header>
        {operatorControls}
        <dl>
          <div>
            <dt>Scanning scope</dt>
            <dd>{context}</dd>
          </div>
          <div>
            <dt>Current result</dt>
            <dd>{currentResult}</dd>
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
              {pending} pending{uploadStatus && <small>{uploadStatus}</small>}
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
              onClose();
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
          {!collectionWaiting && cooldown && cooldown.remainingMs > 0 && (
            <Button variant="secondary" onClick={cooldown.skip}>
              Scan next now
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Return to scanning
          </Button>
          <Button onClick={onExit}>Close scanner</Button>
        </div>
      </HeadingOutline>
    </section>
  );
}
