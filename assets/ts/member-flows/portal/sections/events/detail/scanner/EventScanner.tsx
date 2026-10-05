import { portalSession } from "../../../../state";
import { useScannerSessionFence } from "./useScannerSessionFence";
import { ScannerLeadExport } from "./ScannerLeadExport";
import { useScannerDevice } from "./useScannerDevice";
import { ScannerSessionControls } from "./ScannerSessionControls";
import { useScannerHardware } from "./useScannerHardware";
import { ScannerModeSelect } from "./ScannerModeSelect";
import { useScannerLocation } from "./useScannerLocation";
import { ScannerSetup } from "./ScannerSetup";
import { ScannerCamera } from "./ScannerCamera";
import { useOfflineAdmission } from "./useOfflineAdmission";
import type { LocalEligibility } from "./eligibility-manifest";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  scanActionSchema,
  eventScanCaptureIntentForRoomsSchema,
  eventScanResponseSchema,
  type EventScanResponse,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { CollapsiblePanel } from "../../../../../../ui/CollapsiblePanel";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { openBadgeCamera } from "./camera-driver";
import { ScanFrameGate, receiptMatchesOperation, unknownScanResponse, localScanResponse } from "./scan-stream";
import { drainScanOutbox, pendingScanCount } from "./scan-outbox";
import "./EventScanner.css";
import { FastScannerView } from "./FastScannerView";
import { enterScannerFullscreen, scannerImmersiveLifecycle } from "./immersive-scanner";
import { useEligibilityManifest } from "./useEligibilityManifest";
import { ScannerFeedback } from "./ScannerFeedback";
import { useScanCooldown } from "./useScanCooldown";
import { ScannerPacing } from "./ScannerPacing";
import { useScannerSyncHistory } from "./useScannerSyncHistory";
import { ScannerPreparationStatus } from "./ScannerPreparationStatus";
import { scannerWorkerMessageListener } from "./scanner-worker-messages";
export function EventScanner({
  slug,
  operatorUserId,
  occurrenceId = null,
  sponsorId,
  canExportLeads = false,
  allowedActions = scanActionSchema.options,
}: {
  slug: string;
  operatorUserId: string;
  occurrenceId?: string | null;
  sponsorId?: string;
  canAdmitExceptions?: boolean;
  canExportLeads?: boolean;
  allowedActions?: readonly EventScanRequest["action"][];
}) {
  const [badgeId, setBadge] = useState("");
  const [action, setAction] = useState<EventScanRequest["action"]>(
    sponsorId
      ? "lead"
      : allowedActions.includes("attendance")
        ? "attendance"
        : (allowedActions.find((value) => value === "check" || value === "checkout") ?? "check"),
  );
  const [consentConfirmed, setConsent] = useState(false);
  const [pending, setPending] = useState(0);
  const [pendingReadyScope, setPendingReadyScope] = useState<string | null>(null);
  const lastOperation = useRef<string | null>(null);
  const lastCommittedOperation = useRef<string | null>(null);
  const lastBadge = useRef("");
  const scannerDevice = useScannerDevice(slug, operatorUserId, sponsorId);
  const { deviceId } = scannerDevice;
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<EventScanResponse | null>(null);
  const [message, updateMessage] = useState("Ready to scan");
  const messageOperation = useRef<string | null>(null);
  function setMessage(value: string) {
    messageOperation.current = null;
    updateMessage(value);
  }
  function showProvisionalMessage(operation: string, value: string) {
    if (lastCommittedOperation.current === operation || !receiptMatchesOperation(operation, lastOperation.current))
      return;
    messageOperation.current = operation;
    updateMessage(value);
  }
  const [uploadStatus, setUploadStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [screenAwake, setScreenAwake] = useState(false);
  const [feedbackPause, setFeedbackPause] = useState(600);
  const cooldown = useScanCooldown(feedbackPause);
  const [fastMode, setFastMode] = useState(false);
  const [preview, setPreview] = useState(false);
  const scannerShell = useRef<HTMLDivElement>(null);
  const stopCamera = useRef<() => void>(() => {});
  const {
    targetId,
    targetLabel,
    rooms: targetRooms,
    roomId,
    selectTarget,
    selectRoom,
  } = useScannerLocation(slug, occurrenceId, action !== "lead", () => {
    stopCamera.current();
    lastOperation.current = null;
    setResult(null);
  });
  const { eligibilityManifest, manifestReady, manifestPreparing, manifestError } = useEligibilityManifest(
    slug,
    operatorUserId,
    targetId,
    action,
    () => {
      authorityPaused.current = true;
      stopCamera.current();
      lastOperation.current = null;
      setResult(null);
      setMessage("Sign in again to upload pending scans.");
    },
    roomId,
    scannerDevice.epoch,
  );
  const offlineAdmission = useOfflineAdmission(slug, operatorUserId, eligibilityManifest);
  useEffect(() => {
    if (!fastMode || !scannerShell.current) return;
    const release = scannerImmersiveLifecycle(scannerShell.current, () => setFastMode(false), setScreenAwake);
    return () => {
      stopCamera.current();
      cooldown.reset();
      release();
    };
  }, [fastMode]);
  useScannerHardware(fastMode, (credential) => void scanCredential(credential));
  const form = useContractForm(eventScanCaptureIntentForRoomsSchema(targetRooms.map((room) => room.id)), {
    operationId,
    operatorUserId,
    deviceId,
    badgeId,
    occurrenceId: targetId,
    roomId,
    action,
    ...(action === "lead" ? { sponsorId, consentConfirmed } : {}),
    observedAt: new Date().toISOString(),
  });
  const syncHistory = useScannerSyncHistory(operatorUserId, slug);
  const retryTimer = useRef<number | null>(null);
  const activeSyncs = useRef(0);
  const syncAgain = useRef(false);
  const authorityPaused = useRef(false);
  const operatorPaused = useRef(false);
  function presentReceipt(receipt: EventScanResponse) {
    if (authorityPaused.current || !receiptMatchesOperation(receipt.operationId, lastOperation.current)) return;
    lastCommittedOperation.current = receipt.operationId;
    setResult(receipt);
    if (messageOperation.current === receipt.operationId) setMessage("");
  }
  useScannerSessionFence(operatorUserId, () => {
    authorityPaused.current = true;
    stopCamera.current();
    lastOperation.current = null;
    lastBadge.current = "";
    eligibilityManifest.current = null;
    setBadge("");
    setConsent(false);
    setResult(null);
    syncAgain.current = false;
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  });
  const scannerContext = useRef({ targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms });
  scannerContext.current = { targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms };
  async function sync() {
    if (activeSyncs.current >= 4) {
      syncAgain.current = true;
      return;
    }
    activeSyncs.current++;
    try {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      const drained = await drainScanOutbox(async (record) => {
        const response = await fetch(`/api/v1/events/${encodeURIComponent(record.eventId)}/scans`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record.scan),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const receipt = eventScanResponseSchema.parse(await response.clone().json());
          presentReceipt(receipt);
        }
        return response;
      }, operatorUserId);
      if (drained.state === "authentication_required") {
        authorityPaused.current = true;
        setResult(null);
        stopCamera.current();
        syncAgain.current = false;
      }
      if (drained.uploaded > 0) await syncHistory.refresh();
      const remaining = await pendingScanCount(operatorUserId);
      setPending(remaining);
      setPendingReadyScope(`${slug}:${operatorUserId}`);
      if (remaining > 0 && drained.state !== "authentication_required") {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration("/portal/");
          if (registration && "sync" in registration)
            void (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync
              .register("pkic-scanner-upload")
              .catch(() => {});
        }
      }
      if (drained.state === "retry" && navigator.onLine)
        retryTimer.current = window.setTimeout(() => {
          void sync();
        }, drained.retryAfterMs ?? 1000);
      if (authorityPaused.current) setMessage("Sign in again to upload pending scans.");
      setUploadStatus(
        authorityPaused.current
          ? "Sign in again to upload pending scans."
          : remaining === 0
            ? "All pending scans uploaded."
            : drained.state === "retry"
              ? "Uploads will resume when connected."
              : "Uploading scans in the background…",
      );
    } finally {
      activeSyncs.current--;
      if (syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
    }
  }
  useEffect(() => {
    setPendingReadyScope(null);
    const reconnect = () => {
      void sync();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    const acknowledged = scannerWorkerMessageListener({
      currentOperation: () => lastOperation.current,
      authorityPaused: () => authorityPaused.current,
      setResult: presentReceipt,
      refreshPending: async () => setPending(await pendingScanCount(operatorUserId)),
      syncCurrentOperator: sync,
    });
    navigator.serviceWorker?.addEventListener("message", acknowledged);
    const resume = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    document.addEventListener("visibilitychange", resume);
    reconnect();
    return () => {
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      navigator.serviceWorker?.removeEventListener("message", acknowledged);
      document.removeEventListener("visibilitychange", resume);
      authorityPaused.current = true;
      stopCamera.current();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [slug, operatorUserId]);
  function showLocalEligibility(scan: EventScanRequest, local?: LocalEligibility) {
    if (!local || authorityPaused.current) return;
    if (
      lastCommittedOperation.current === scan.operationId ||
      !receiptMatchesOperation(scan.operationId, lastOperation.current)
    )
      return;
    setResult(localScanResponse(scan.operationId, local));
    showProvisionalMessage(scan.operationId, local.message);
  }
  function resetCaptureFields() {
    form.reset();
    setBadge("");
    if (action === "lead") setConsent(false);
    setOperation(crypto.randomUUID());
  }
  async function submit(event: Event) {
    event.preventDefault();
    if (!scannerDevice.ready) return;
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
    const checked = form.submit();
    if (!checked.data) {
      lastOperation.current = null;
      setMessage("Invalid QR code. Scan a PKI Consortium badge.");
      setResult(unknownScanResponse(operationId));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      lastBadge.current = checked.data.badgeId;
      lastOperation.current = checked.data.operationId;
      const saved = await offlineAdmission.persist(checked.data);
      setUploadStatus("Uploading scans in the background…");
      setPending(await pendingScanCount(operatorUserId));
      showProvisionalMessage(saved.scan.operationId, "Scan saved. Checking eligibility…");
      showLocalEligibility(saved.scan, saved.local);
      void sync();
      resetCaptureFields();
    } catch {
      setMessage("Unable to save this scan. Keep the attendee here and retry.");
    } finally {
      setBusy(false);
    }
  }
  const cameraFrames = useRef(new ScanFrameGate());
  async function scanCredential(raw: string, fromCamera = false) {
    if (!scannerDevice.ready || authorityPaused.current || operatorPaused.current) return;
    const current = scannerContext.current;
    if (current.action === "lead" || current.action === "exception") {
      setBadge(raw);
      lastBadge.current = raw;
      stopCamera.current();
      setFastMode(false);
      if (current.action === "lead") setConsent(false);
      setMessage("Badge detected. Review and confirm before recording.");
      return;
    }
    if (fastMode && !cooldown.ready()) return;
    const parsed = eventScanCaptureIntentForRoomsSchema(current.rooms.map((room) => room.id)).safeParse({
      operatorUserId: current.operatorUserId,
      operationId: crypto.randomUUID(),
      deviceId: current.deviceId,
      badgeId: raw,
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
        stopCamera.current();
        return;
      }
      if (fastMode && !cooldown.accept()) return;
      lastOperation.current = null;
      setResult(unknownScanResponse(crypto.randomUUID()));
      setMessage("Invalid QR code. Scan a PKI Consortium badge.");
      if (fastMode) cooldown.feedback();
      return;
    }
    if (fromCamera && !cameraFrames.current.accept(parsed.data.badgeId, Date.now())) return;
    if (fastMode && !cooldown.accept()) return;
    const operation = parsed.data.operationId;
    lastOperation.current = operation;
    lastBadge.current = parsed.data.badgeId;
    setResult(null);
    showProvisionalMessage(operation, "Checking eligibility…");
    try {
      const saved = await offlineAdmission.persist(parsed.data);
      setUploadStatus("Uploading scans in the background…");
      setPending(await pendingScanCount(operatorUserId));
      showLocalEligibility(saved.scan, saved.local);
      resetCaptureFields();
      if (fastMode) cooldown.feedback();
      void sync();
    } catch {
      if (fastMode) cooldown.reset();
      if (receiptMatchesOperation(operation, lastOperation.current)) setMessage("Unable to save scan. Retry.");
    }
  }
  async function camera() {
    if (!scannerDevice.ready) return;
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
    try {
      if (!video.current) return;
      stopCamera.current();
      cameraFrames.current.clear();
      await openBadgeCamera(
        video.current,
        (raw) => {
          void scanCredential(raw, true);
        },
        setCameraActive,
        (stop) => {
          stopCamera.current = stop;
        },
      );
    } catch {
      stopCamera.current();
      setCameraActive(false);
      setMessage("Camera access is unavailable. Use a connected scanner or manual entry.");
    }
  }
  const preparation = {
    lastSync: syncHistory.lastSync,
    snapshot: eligibilityManifest.current,
    stale: Boolean(eligibilityManifest.current && Date.now() >= eligibilityManifest.current.validUntil),
    action,
    preparing: manifestPreparing,
    ready: manifestReady,
    error: manifestError,
  };
  return (
    <div ref={scannerShell}>
      <div hidden={fastMode}>
        <Panel>
          <PanelHeader title="Badge scanner" />
          {sponsorId && canExportLeads && <ScannerLeadExport slug={slug} sponsorId={sponsorId} />}
          <PanelBody>
            <p>No attendee names or contact details are stored on this phone.</p>
            <CollapsiblePanel title="Recovery and diagnostics">
              <PanelBody>
                <ScannerSessionControls
                  sessionId={portalSession.value?.sessionId}
                  scanner={scannerDevice}
                  slug={slug}
                  operatorUserId={operatorUserId}
                  sponsorId={sponsorId}
                  sync={sync}
                  message={setMessage}
                  capturePause={(paused) => {
                    if (paused) stopCamera.current();
                    operatorPaused.current = paused;
                  }}
                />
              </PanelBody>
            </CollapsiblePanel>
            <ScannerFeedback result={result} action={action} message={message} pending={pending} />
            <form noValidate {...form.handlers} onSubmit={submit}>
              <ScannerPacing value={feedbackPause} onChange={setFeedbackPause} />
              <ScannerSetup
                operatorUserId={operatorUserId}
                sponsorOnly={action === "lead"}
                explicitTarget={Boolean(occurrenceId)}
                ready={pendingReadyScope === `${slug}:${operatorUserId}`}
                locked={
                  cameraActive ||
                  fastMode ||
                  busy ||
                  cooldown.saving ||
                  cooldown.remainingMs > 0 ||
                  Boolean(lastOperation.current) ||
                  pending > 0
                }
                slug={slug}
                targetId={targetId}
                label={targetLabel}
                roomId={roomId}
                rooms={targetRooms}
                targetField={form.of("occurrenceId")}
                roomField={form.of("roomId")}
                onTarget={selectTarget}
                onRoom={selectRoom}
              />
              <ScannerModeSelect
                action={action}
                allowedActions={allowedActions}
                sponsorId={sponsorId}
                actionField={form.of("action")}
                onAction={(value) => {
                  stopCamera.current();
                  lastOperation.current = null;
                  setAction(value);
                  setResult(null);
                }}
              />
              {action === "lead" && (
                <Field label="Attendee consent" {...form.of("consentConfirmed")} group>
                  {(control) => (
                    <Checkbox
                      {...control}
                      name="consentConfirmed"
                      checked={consentConfirmed}
                      onChange={(event) => setConsent(event.currentTarget.checked)}
                      label="The attendee agrees to share their contact details with this sponsor."
                    />
                  )}
                </Field>
              )}
              <Field label="Badge code" {...form.of("badgeId")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="badgeId"
                    value={badgeId}
                    onInput={(event) => setBadge(event.currentTarget.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Button type="submit" loading={busy}>
                {action === "lead"
                  ? "Capture lead"
                  : action === "checkout"
                    ? "Record checkout"
                    : action === "attendance"
                      ? "Record attendance"
                      : "Check registration"}
              </Button>{" "}
              {(action === "attendance" || action === "check" || action === "checkout") && (
                <>
                  <Button
                    type="button"
                    disabled={!scannerDevice.ready || !manifestReady || manifestPreparing}
                    onClick={() => {
                      if (scannerShell.current) enterScannerFullscreen(scannerShell.current);
                      setResult(null);
                      lastOperation.current = null;
                      setMessage("Ready to scan");
                      setPreview(false);
                      setFastMode(true);
                      void camera();
                    }}
                  >
                    Start scanning
                  </Button>
                  <ScannerPreparationStatus {...preparation} />
                  {!manifestReady && !manifestPreparing && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        if (scannerShell.current) enterScannerFullscreen(scannerShell.current);
                        lastOperation.current = null;
                        setResult(null);
                        setMessage(
                          action === "checkout"
                            ? "Unverified checkout. Badge verification pending."
                            : "Unverified scanning. Admission requires verification.",
                        );
                        setPreview(false);
                        setFastMode(true);
                        void camera();
                      }}
                    >
                      Start with unverified feedback
                    </Button>
                  )}
                </>
              )}{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (cameraActive) stopCamera.current();
                  else void camera();
                }}
              >
                {cameraActive ? "Stop camera" : "Use camera"}
              </Button>{" "}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void sync();
                }}
              >
                Sync now
              </Button>
            </form>
          </PanelBody>
        </Panel>
      </div>
      {fastMode && (
        <FastScannerView
          canRecordAttendance={allowedActions.includes("attendance")}
          context={`${targetLabel || (targetId ? "Session check-in" : `Event · ${slug}`)}${roomId ? ` · ${targetRooms.find((room) => room.id === roomId)?.name ?? "Room"}` : ""}`}
          result={result}
          preparation={preparation}
          mode={action}
          pending={pending}
          message={message}
          uploadStatus={uploadStatus}
          cooldown={cooldown}
          screenAwake={screenAwake}
          onOperatorPause={(paused) => {
            operatorPaused.current = paused;
          }}
          cameraActive={cameraActive}
          preview={preview}
          onPreview={() => setPreview(!preview)}
          onExit={() => {
            cooldown.reset();
            lastOperation.current = null;
            setResult(null);
            setFastMode(false);
          }}
        />
      )}
      <ScannerCamera video={video} cameraActive={cameraActive} fastMode={fastMode} preview={preview} />
    </div>
  );
}
