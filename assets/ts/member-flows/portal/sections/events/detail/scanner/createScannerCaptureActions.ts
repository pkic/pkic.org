import type { MutableRef } from "preact/hooks";
import type { ContractForm } from "../../../../../../hooks/useContractForm";
import { badgeCredentialSchema } from "../../../../../../../shared/schemas/badge-credential";
import { boundedScannedValue } from "../../../../../../../shared/schemas/scanner-attempt-capture";
import {
  eventScanCaptureIntentForRoomsSchema,
  type EventScanRequest,
  type ScannerTarget,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { receiptMatchesOperation, unknownScanResponse } from "./scan-stream";
import type { useBadgeCollection } from "./useBadgeCollection";
import type { useScannerFeedback } from "./useScannerFeedback";
import { ScannerCapturePersistenceError, type useScannerFailureCapture } from "./useScannerFailureCapture";
import type { useScannerOutboxSync } from "./useScannerOutboxSync";
import type { useScannerManualEntry } from "./useScannerManualEntry";
import type { useScannerCamera } from "./useScannerCamera";
import type { useScanCooldown } from "./useScanCooldown";
import type { useOfflineAdmission } from "./useOfflineAdmission";

type Feedback = ReturnType<typeof useScannerFeedback>;
type Outbox = ReturnType<typeof useScannerOutboxSync>;
interface ScannerCaptureActions {
  requestCapture: () => boolean;
  captureAllowed: () => boolean;
  manualCapturePending: MutableRef<boolean>;
  collection: Pick<ReturnType<typeof useBadgeCollection>, "held" | "begin" | "clear">;
  form: Pick<ContractForm<EventScanRequest>, "submit">;
  auditFailure: ReturnType<typeof useScannerFailureCapture>;
  badgeId: string;
  lastOperation: MutableRef<string | null>;
  setMessage: Feedback["setMessage"];
  action: EventScanRequest["action"];
  setResult: Feedback["setResult"];
  operationId: string;
  setBusy: (busy: boolean) => void;
  persistCapture: ReturnType<typeof useOfflineAdmission>["persist"];
  scanSaved: Outbox["scanSaved"];
  resetCaptureFields: () => void;
  presentSavedEligibility: Feedback["presentSavedEligibility"];
  verifyQueuedScan: Outbox["verifyQueuedScan"];
  fastMode: boolean;
  feedbackHeld: boolean;
  manualOpen: boolean;
  cooldown: ReturnType<typeof useScanCooldown>;
  camera: () => Promise<void>;
  failure: Feedback["failure"];
  operatorPaused: MutableRef<boolean>;
  manualPaused: MutableRef<boolean>;
  scannerContext: MutableRef<{
    targetId: string | null;
    action: EventScanRequest["action"];
    operatorUserId: string;
    deviceId: string;
    roomId: string | null;
    rooms: NonNullable<ScannerTarget["rooms"]>;
  }>;
  badgeCamera: ReturnType<typeof useScannerCamera>;
  manual: ReturnType<typeof useScannerManualEntry>;
  setBadge: (value: string) => void;
  setFastMode: (value: boolean) => void;
  consentConfirmed: boolean;
  showProvisionalMessage: Feedback["showProvisionalMessage"];
}

/** Manual confirmation and decoded QR capture share the existing persistence and feedback boundary. */
export function createScannerCaptureActions({
  requestCapture,
  captureAllowed,
  manualCapturePending,
  collection,
  form,
  auditFailure,
  badgeId,
  lastOperation,
  setMessage,
  action,
  setResult,
  operationId,
  setBusy,
  persistCapture,
  scanSaved,
  resetCaptureFields,
  presentSavedEligibility,
  verifyQueuedScan,
  fastMode,
  feedbackHeld,
  manualOpen,
  cooldown,
  camera,
  failure,
  operatorPaused,
  manualPaused,
  scannerContext,
  badgeCamera,
  manual,
  setBadge,
  setFastMode,
  consentConfirmed,
  showProvisionalMessage,
}: ScannerCaptureActions) {
  async function capture() {
    if (!requestCapture() || manualCapturePending.current || collection.held.current) return;
    const checked = form.submit();
    if (!checked.data) {
      if (
        !(await auditFailure(
          badgeId,
          badgeCredentialSchema.safeParse(badgeId).success ? "capture_validation_failed" : "malformed_credential",
        ))
      )
        return;
      lastOperation.current = null;
      setMessage(action === "lead" ? (checked.formMessage ?? "") : "Invalid QR code. Scan a PKI Consortium badge.");
      setResult(action === "lead" ? null : unknownScanResponse(operationId));
      return;
    }
    collection.begin(checked.data.badgeId);
    manualCapturePending.current = true;
    setBusy(true);
    setResult(null);
    let persisted = false;
    try {
      lastOperation.current = checked.data.operationId;
      const saved = await persistCapture(checked.data);
      persisted = true;
      await scanSaved();
      resetCaptureFields();
      if (!(await presentSavedEligibility(saved, verifyQueuedScan))) return;
      if (fastMode && manualOpen && action !== "lead") {
        cooldown.feedback();
        void camera();
      }
    } catch (error) {
      if (!persisted && error instanceof ScannerCapturePersistenceError && error.retryAllowed) collection.clear();
      failure(error instanceof Error ? error.message : "Unable to save this scan. Keep the attendee here and retry.");
    } finally {
      manualCapturePending.current = false;
      setBusy(false);
    }
  }
  async function scanCredential(raw: string, fromCamera = false) {
    if (action === "lead" && !consentConfirmed) return;
    if (!captureAllowed() || collection.held.current || feedbackHeld) return;
    if (operatorPaused.current || manualPaused.current || manualCapturePending.current) return;
    const current = scannerContext.current;
    if (current.action === "lead" || current.action === "exception") {
      badgeCamera.stop();
      if (fastMode) manualPaused.current = true;
      setBadge(raw);
      manual.setOpen(true);
      manual.setFocusRequested(true);
      if (current.action !== "lead") setFastMode(false);
      setMessage("Badge detected. Review and confirm before recording.");
      return;
    }
    if (fastMode && !cooldown.ready()) return;
    const parsed = eventScanCaptureIntentForRoomsSchema(current.rooms.map((room) => room.id)).safeParse({
      operatorUserId: current.operatorUserId,
      operationId: crypto.randomUUID(),
      deviceId: current.deviceId,
      badgeId: raw,
      ...boundedScannedValue(raw),
      occurrenceId: current.targetId,
      roomId: current.roomId,
      action: current.action,
      observedAt: new Date().toISOString(),
    });
    if (!parsed.success) {
      const locationError = parsed.error.issues.find((issue) => issue.path[0] === "roomId");
      if (locationError) {
        setMessage(locationError.message);
        setFastMode(false);
        badgeCamera.stop();
        return;
      }
      if (fastMode && !cooldown.accept()) return;
      lastOperation.current = null;
      if (!(await auditFailure(raw, "unsupported_code"))) {
        if (fastMode) cooldown.feedback();
        return;
      }
      setResult(unknownScanResponse(crypto.randomUUID()));
      setMessage("Invalid QR code. Scan a PKI Consortium badge.");
      if (fastMode) cooldown.feedback();
      return;
    }
    if (fromCamera && !badgeCamera.acceptsFrame(parsed.data.badgeId)) return;
    if (fastMode && !cooldown.accept()) return;
    collection.begin(parsed.data.badgeId);
    const operation = parsed.data.operationId;
    lastOperation.current = operation;
    setResult(null);
    showProvisionalMessage(operation, "Checking eligibility…");
    let persisted = false;
    try {
      const saved = await persistCapture(parsed.data);
      persisted = true;
      await scanSaved();
      if (!(await presentSavedEligibility(saved, verifyQueuedScan))) return;
      resetCaptureFields();
      if (fastMode) cooldown.feedback();
    } catch (error) {
      if (!persisted && error instanceof ScannerCapturePersistenceError && error.retryAllowed) collection.clear();
      setBadge(raw);
      if (fastMode && receiptMatchesOperation(operation, lastOperation.current)) cooldown.feedback();
      if (receiptMatchesOperation(operation, lastOperation.current))
        failure(error instanceof Error ? error.message : "Unable to save scan. Retry.");
    }
  }
  return { capture, scanCredential };
}
