import { Tabs } from "../../../../../../components/Tabs";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { ScannerCaptureContext } from "./ScannerCaptureContext";
import { ScannerSyncStatus } from "./ScannerPreparationStatus";
import { portalSession } from "../../../../state";
import { useScannerSessionFence } from "./useScannerSessionFence";
import { ScannerLeadExport } from "./ScannerLeadExport";
import { useScannerDevice } from "./useScannerDevice";
import { useScannerHardware } from "./useScannerHardware";
import {
  ScannerCaptureControls,
  ScannerDiagnostics,
  ScannerManualControls,
  scannerStartMessage,
} from "./ScannerCaptureControls";
import { useScannerLocation } from "./useScannerLocation";
import { ScannerCamera } from "./ScannerCamera";
import { ScannerRecentScans } from "./ScannerRecentScans";
import { useOfflineAdmission } from "./useOfflineAdmission";
import type { LocalEligibility } from "./eligibility-manifest";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  scanActionSchema,
  eventScanCaptureIntentForRoomsSchema,
  type EventScanResponse,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { openBadgeCamera } from "./camera-driver";
import { ScanFrameGate, receiptMatchesOperation, unknownScanResponse, localScanResponse } from "./scan-stream";
import { pendingScanCount } from "./scan-outbox";
import { useScannerOutboxSync } from "./useScannerOutboxSync";
import "./EventScanner.css";
import { FastScannerView } from "./FastScannerView";
import { enterScannerFullscreen, scannerImmersiveLifecycle } from "./immersive-scanner";
import { useEligibilityManifest, useScannerOfflinePreparation } from "./useEligibilityManifest";
import { ScannerFeedback } from "./ScannerFeedback";
import { useScanCooldown } from "./useScanCooldown";
import { useScannerSyncHistory } from "./useScannerSyncHistory";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { scannerPreparationRefusal } from "./scanner-offline-context";
export function EventScanner({
  slug,
  operatorUserId,
  occurrenceId = null,
  sponsorId,
  canExportLeads = false,
  allowedActions = scanActionSchema.options,
  collectorContext,
  onCheckSignIn,
}: {
  slug: string;
  operatorUserId: string;
  occurrenceId?: string | null;
  sponsorId?: string;
  canAdmitExceptions?: boolean;
  canExportLeads?: boolean;
  allowedActions?: readonly EventScanRequest["action"][];
  collectorContext?: ScannerOfflineContext;
  onCheckSignIn?: () => void;
}) {
  const refusePreparation = scannerPreparationRefusal(portalSession.value, operatorUserId);
  const [badgeId, setBadge] = useState("");
  const [action, setAction] = useState<EventScanRequest["action"]>(
    collectorContext?.action ??
      (sponsorId
        ? "lead"
        : allowedActions.includes("attendance")
          ? "attendance"
          : (allowedActions.find((value) => value !== "lead" && value !== "exception") ?? "check")),
  );
  const [manualFocusRequested, setManualFocusRequested] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [scannerTab, setScannerTab] = useHashQueryParam("scannerTab", "scan");
  const recentVisible = scannerTab === "recent" && !collectorContext;
  const [consentConfirmed, setConsent] = useState(false);
  const lastOperation = useRef<string | null>(null);
  const lastCommittedOperation = useRef<string | null>(null);
  const lastBadge = useRef("");
  const scannerDevice = useScannerDevice(slug, operatorUserId, sponsorId, collectorContext);
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
  const [busy, setBusy] = useState(false);
  const manualCapturePending = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState("");
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
    target,
    timeZone,
    setTimeZone,
    rooms: targetRooms,
    roomId,
    selectTarget,
    selectRoom,
  } = useScannerLocation(
    slug,
    occurrenceId,
    action !== "lead",
    () => {
      stopCamera.current();
      lastOperation.current = null;
      setResult(null);
    },
    collectorContext,
  );
  const { eligibilityManifest, manifestReady, manifestPreparing, manifestError } = useEligibilityManifest(
    slug,
    operatorUserId,
    targetId,
    action,
    () => {
      refusePreparation();
      authorityPaused.current = true;
      stopCamera.current();
      lastOperation.current = null;
      setResult(null);
      setMessage("Sign in again to upload pending scans.");
    },
    roomId,
    scannerDevice.epoch,
    Boolean(collectorContext),
  );
  const offlineAdmission = useOfflineAdmission(slug, operatorUserId, eligibilityManifest, collectorContext);
  const offlinePreparation = useScannerOfflinePreparation(
    collectorContext ? null : portalSession.value,
    scannerDevice.epoch,
    eligibilityManifest.current,
    slug,
    action,
  );
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
  const authorityPaused = useRef(false);
  const operatorPaused = useRef(false);
  function presentReceipt(receipt: EventScanResponse) {
    if (
      collectorContext ||
      authorityPaused.current ||
      !receiptMatchesOperation(receipt.operationId, lastOperation.current)
    )
      return;
    lastCommittedOperation.current = receipt.operationId;
    setResult(receipt);
    if (messageOperation.current === receipt.operationId) setMessage("");
  }
  useScannerSessionFence(
    operatorUserId,
    () => {
      authorityPaused.current = true;
      stopCamera.current();
      lastOperation.current = null;
      lastBadge.current = "";
      eligibilityManifest.current = null;
      setBadge("");
      setConsent(false);
      setResult(null);
      cancelRetries();
    },
    collectorContext?.sessionId,
  );
  const scannerContext = useRef({ targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms });
  scannerContext.current = { targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms };
  const { pending, setPending, pendingReadyScope, uploadStatus, setUploadStatus, sync, cancelRetries } =
    useScannerOutboxSync({
      slug,
      operatorUserId,
      collectorContext,
      authorityPaused,
      currentOperation: () => lastOperation.current,
      presentReceipt,
      setResult,
      setMessage,
      stopCamera: () => stopCamera.current(),
      refreshHistory: syncHistory.refresh,
    });
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
    setManualFocusRequested(false);
    setManualOpen(false);
    form.reset();
    setBadge("");
    if (action === "lead") setConsent(false);
    setOperation(crypto.randomUUID());
  }
  function submit(event: Event) {
    event.preventDefault();
    void capture();
  }
  async function capture() {
    if (!scannerDevice.ready || manualCapturePending.current) return;
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
    const checked = form.submit();
    if (!checked.data) {
      lastOperation.current = null;
      setMessage(action === "lead" ? checked.message : "Invalid QR code. Scan a PKI Consortium badge.");
      setResult(action === "lead" ? null : unknownScanResponse(operationId));
      return;
    }
    manualCapturePending.current = true;
    setBusy(true);
    setResult(null);
    try {
      lastBadge.current = checked.data.badgeId;
      lastOperation.current = checked.data.operationId;
      const saved = await offlineAdmission.persist(checked.data);
      setUploadStatus(collectorContext ? "Saved offline · not yet verified" : "Uploading scans in the background…");
      setPending(await pendingScanCount(operatorUserId));
      showProvisionalMessage(saved.scan.operationId, "Scan saved. Checking eligibility…");
      showLocalEligibility(saved.scan, saved.local);
      void sync();
      resetCaptureFields();
    } catch {
      setMessage("Unable to save this scan. Keep the attendee here and retry.");
    } finally {
      manualCapturePending.current = false;
      setBusy(false);
    }
  }
  const cameraFrames = useRef(new ScanFrameGate());
  const cameraCapture = useRef(scanCredential);
  cameraCapture.current = scanCredential;
  async function scanCredential(raw: string, fromCamera = false) {
    if (!scannerDevice.ready || authorityPaused.current || operatorPaused.current) return;
    const current = scannerContext.current;
    if (current.action === "lead" || current.action === "exception") {
      setBadge(raw);
      setManualOpen(true);
      setManualFocusRequested(true);
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
      setUploadStatus(collectorContext ? "Saved offline · not yet verified" : "Uploading scans in the background…");
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
    if (!scannerDevice.ready || cameraStarting) return;
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
    try {
      if (!video.current) return;
      stopCamera.current();
      setCameraStarting(true);
      setCameraError("");
      cameraFrames.current.clear();
      await openBadgeCamera(
        video.current,
        (raw) => void cameraCapture.current(raw, true),
        setCameraActive,
        (stop) => {
          stopCamera.current = stop;
        },
      );
    } catch {
      stopCamera.current();
      setCameraActive(false);
      setCameraError("Camera access is unavailable. Retry the camera, use a connected reader, or paste a badge code.");
    } finally {
      setCameraStarting(false);
    }
  }
  function startScanning() {
    if (!allowedActions.includes(action) || !scannerDevice.ready) return;
    if (scannerShell.current) enterScannerFullscreen(scannerShell.current);
    lastOperation.current = null;
    setResult(null);
    setMessage(scannerStartMessage(manifestReady, Boolean(collectorContext)));
    setPreview(false);
    setFastMode(true);
    void camera();
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
  function showRecentScans() {
    stopCamera.current();
    setFastMode(false);
    setManualFocusRequested(false);
    setManualOpen(false);
    setScannerTab("recent");
  }
  useEffect(() => {
    if (recentVisible) {
      stopCamera.current();
      setFastMode(false);
      setManualFocusRequested(false);
      setManualOpen(false);
    }
  }, [recentVisible]);
  const contextLabel = `${targetLabel || (targetId ? "Session check-in" : "Event entrance")}${roomId ? ` · ${targetRooms.find((room) => room.id === roomId)?.name ?? "Room"}` : ""}`;
  return (
    <div ref={scannerShell}>
      <div hidden={fastMode}>
        {!collectorContext && (
          <Tabs
            label="Badge scanner views"
            idPrefix="scanner-view"
            active={recentVisible ? "recent" : "scan"}
            onChange={(view) => {
              if (view === "recent") showRecentScans();
              else setScannerTab("scan");
            }}
            items={[
              { key: "scan", label: "Scan", panelId: "scanner-scan-panel" },
              { key: "recent", label: "Recent scans", panelId: "scanner-recent-panel" },
            ]}
          />
        )}
        <div
          id="scanner-scan-panel"
          role="tabpanel"
          aria-labelledby={collectorContext ? undefined : "scanner-view-scan"}
          hidden={recentVisible}
        >
          <Panel>
            <PanelHeader title="Badge scanner" />
            {!collectorContext && sponsorId && canExportLeads && (
              <ScannerLeadExport slug={slug} sponsorId={sponsorId} />
            )}
            <PanelBody>
              <ScannerCaptureContext action={action} contextLabel={contextLabel} target={target} timeZone={timeZone} />
              {(result || pending > 0 || message !== "Ready to scan") && (
                <ScannerFeedback result={result} action={action} message={message} pending={pending} />
              )}
              <form class="pk-form" noValidate aria-busy={busy} {...form.handlers} onSubmit={submit}>
                <ScannerCaptureControls
                  collector={collectorContext}
                  onCheckSignIn={onCheckSignIn}
                  setup={{
                    operatorUserId,
                    sponsorOnly: action === "lead",
                    explicitTarget: Boolean(occurrenceId),
                    ready: pendingReadyScope === `${slug}:${operatorUserId}`,
                    locked:
                      cameraActive ||
                      fastMode ||
                      busy ||
                      cooldown.saving ||
                      cooldown.remainingMs > 0 ||
                      Boolean(lastOperation.current) ||
                      pending > 0,
                    slug,
                    targetId,
                    label: targetLabel,
                    roomId,
                    rooms: targetRooms,
                    onTimeZone: setTimeZone,
                    targetField: form.of("occurrenceId"),
                    roomField: form.of("roomId"),
                    onTarget: selectTarget,
                    onRoom: selectRoom,
                  }}
                  mode={{
                    action,
                    allowedActions,
                    sponsorId,
                    actionField: form.of("action"),
                    onAction: (value) => {
                      stopCamera.current();
                      lastOperation.current = null;
                      setAction(value);
                      setResult(null);
                    },
                  }}
                  canStart={
                    scannerDevice.ready &&
                    Boolean(collectorContext || action === "lead" || (manifestReady && !manifestPreparing))
                  }
                  preparing={manifestPreparing || !scannerDevice.ready}
                  cameraError={cameraError}
                  start={startScanning}
                />
                <ScannerManualControls
                  action={action}
                  busy={busy}
                  ready={scannerDevice.ready}
                  onCapture={() => void capture()}
                  consent={
                    action === "lead"
                      ? { confirmed: consentConfirmed, field: form.of("consentConfirmed"), onChange: setConsent }
                      : undefined
                  }
                  open={manualOpen}
                  onOpen={() => {
                    stopCamera.current();
                    setManualOpen(true);
                    setManualFocusRequested(true);
                  }}
                  onClose={() => {
                    setManualOpen(false);
                    setManualFocusRequested(false);
                  }}
                  entry={{
                    focusRequested: manualFocusRequested,
                    onFocusHandled: () => setManualFocusRequested(false),
                    badgeId,
                    onBadge: setBadge,
                    field: form.of("badgeId"),
                  }}
                />
              </form>
              <ScannerSyncStatus
                pending={pending}
                lastSync={syncHistory.lastSync}
                uploadStatus={uploadStatus}
                collector={collectorContext}
                offline={offlinePreparation}
                action={action}
                sync={collectorContext ? undefined : () => void sync()}
              />
              {!collectorContext && (
                <ScannerDiagnostics
                  session={{
                    sessionId: portalSession.value?.sessionId,
                    scanner: scannerDevice,
                    slug,
                    operatorUserId,
                    sponsorId,
                    sync,
                    message: setMessage,
                    capturePause: (paused) => {
                      if (paused) stopCamera.current();
                      operatorPaused.current = paused;
                    },
                  }}
                  pacing={{ value: feedbackPause, onChange: setFeedbackPause }}
                  preparation={preparation}
                  unverifiedStart={
                    action !== "lead" && !manifestReady && !manifestPreparing ? startScanning : undefined
                  }
                />
              )}
            </PanelBody>
          </Panel>
        </div>
        {!collectorContext && (
          <div id="scanner-recent-panel" role="tabpanel" aria-labelledby="scanner-view-recent" hidden={!recentVisible}>
            <ScannerRecentScans
              active={recentVisible}
              slug={slug}
              operatorUserId={operatorUserId}
              pending={pending}
              lastSync={syncHistory.lastSync}
            />
          </div>
        )}
      </div>
      {fastMode && (
        <FastScannerView
          canRecordAttendance={!collectorContext && allowedActions.includes("attendance")}
          context={contextLabel}
          result={result}
          preparation={collectorContext ? undefined : preparation}
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
          cameraStarting={cameraStarting}
          cameraError={cameraError}
          onCameraRetry={() => void camera()}
          onManual={() => {
            setManualOpen(true);
            setManualFocusRequested(true);
            setFastMode(false);
          }}
          onRecentScans={collectorContext ? undefined : showRecentScans}
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
