import { useScannerManualEntry } from "./useScannerManualEntry";
import { ScannerDiagnosticsView } from "./ScannerDiagnosticsView";
import { useScannerFeedback } from "./useScannerFeedback";
import { badgeCredentialSchema } from "../../../../../../../shared/schemas/badge-credential";
import { boundedScannedValue } from "../../../../../../../shared/schemas/scanner-attempt-capture";
import { useScannerFailureCapture, persistScannerCapture } from "./useScannerFailureCapture";
import type { EventScannerProps } from "./EventScanner";
import { ScannerWorkspace } from "./ScannerWorkspace";
import { useScannerImmersiveLifecycle } from "./useScannerImmersiveLifecycle";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { scannerContextLabel } from "./ScannerCaptureContext";
import { useScannerAutoStart, useScannerCaptureActive } from "./useScannerAutoStart";
import { ScannerConnectionStatus } from "./ScannerConnectionStatus";
import { useScannerConnection } from "./useScannerConnection";
import { useScannerPreferences } from "./useScannerPreferences";
import { useScannerSound } from "./useScannerSound";
import { useScannerAction } from "./ScannerModeSelect";
import { portalSession } from "../../../../state";
import { useScannerSessionFence } from "./useScannerSessionFence";
import { ScannerLeadExport } from "./ScannerLeadExport";
import { useScannerDevice } from "./useScannerDevice";
import { useScannerHardware } from "./useScannerHardware";
import { ScannerCaptureControls, ScannerManualControls, scannerStartMessage } from "./ScannerCaptureControls";
import { useScannerPreparation } from "./useScannerPreparation";
import { ScannerCamera } from "./ScannerCamera";
import { ScannerRecentScans } from "./ScannerRecentScans";
import { useRef, useState } from "preact/hooks";
import {
  scanActionSchema,
  eventScanCaptureIntentForRoomsSchema,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ScannerLaunchPanel } from "./ScannerLaunchPanel";
import { receiptMatchesOperation, unknownScanResponse } from "./scan-stream";
import { useScannerCamera } from "./useScannerCamera";
import { useScannerOutboxSync } from "./useScannerOutboxSync";
import "./EventScanner.css";
import { FastScannerView } from "./FastScannerView";
import { useScannerPresentation } from "./useScannerPresentation";
import { useScanCooldown } from "./useScanCooldown";
import { useScannerSyncHistory } from "./useScannerSyncHistory";
import { scannerPreparationRefusal } from "./scanner-offline-context";
export function EventScannerCapture({
  slug,
  printHref,
  operatorUserId,
  occurrenceId = null,
  sponsorId,
  sponsorName,
  canExportLeads = false,
  allowedActions = scanActionSchema.options,
  collectorContext,
  onCheckSignIn,
}: EventScannerProps) {
  const refusePreparation = scannerPreparationRefusal(portalSession.value, operatorUserId);
  const [badgeId, setBadge] = useState("");
  const [action, setAction] = useScannerAction(allowedActions, collectorContext?.action, !!sponsorId);
  const [scannerTab, setScannerTab] = useHashQueryParam("scannerTab", "scan", ["scan", "recent", "diagnostics"]);
  const recentVisible = scannerTab === "recent" && !collectorContext;
  const [consentConfirmed, setConsent] = useState(false);
  const lastOperation = useRef<string | null>(null);
  const lastCommittedOperation = useRef<string | null>(null);
  const scannerDevice = useScannerDevice(slug, operatorUserId, sponsorId, collectorContext);
  const { deviceId } = scannerDevice;
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const authorityPaused = useRef(false);
  const [fastMode, setFastMode] = useScannerCaptureActive();
  const preferences = useScannerPreferences();
  const online = useScannerConnection();
  const {
    result,
    lastResult,
    clearFeedback,
    failed,
    captureStatus,
    setResult,
    message,
    setMessage,
    showProvisionalMessage,
    presentReceipt,
    presentSavedEligibility,
    failure,
  } = useScannerFeedback({
    enabled: fastMode,
    durationMs: preferences.feedbackPause,
    collector: Boolean(collectorContext),
    currentOperation: lastOperation,
    committedOperation: lastCommittedOperation,
    authorityPaused,
  });
  const offline = !online || Boolean(collectorContext);
  const [busy, setBusy] = useState(false);
  const manualCapturePending = useRef(false);
  const cooldown = useScanCooldown(preferences.feedbackPause);
  const [preview, setPreview] = useState(false);
  const scannerShell = useRef<HTMLDivElement>(null);
  const { presentation, enter: enterPresentation, toggle: togglePresentation } = useScannerPresentation(scannerShell);
  const badgeCamera = useScannerCamera((raw) => void scanCredential(raw, true));
  const manual = useScannerManualEntry(fastMode, badgeCamera.stop, () => void camera(), recentVisible);
  const { open: manualOpen, focusRequested: manualFocusRequested, paused: manualPaused } = manual;
  const preparation = useScannerPreparation({
    slug,
    operatorUserId,
    occurrenceId,
    action,
    collectorContext,
    epoch: scannerDevice.epoch,
    session: portalSession.value,
    onContextChange: clearCurrentScan,
    onPermissionChanged: () => {
      refusePreparation();
      authorityPaused.current = true;
      clearCurrentScan();
      setMessage("Sign in again to upload pending scans.");
    },
  });
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
  } = preparation.location;
  const { eligibilityManifest, manifestReady, manifestPreparing, manifestError } = preparation.eligibility;
  const { offlineAdmission, offlinePreparation, captureClosed, closedMessage } = preparation;
  const captureReady = scannerDevice.ready && !closedMessage;
  const sound = useScannerSound(preferences.sound, result ?? lastResult, action, failed, Boolean(targetId));
  const screenAwake = useScannerImmersiveLifecycle(
    fastMode,
    scannerShell,
    () => {
      manualPaused.current = false;
      manual.setOpen(false);
      setFastMode(false);
    },
    () => {
      badgeCamera.stop();
      cooldown.reset();
    },
    presentation === "fullscreen",
  );
  useScannerHardware(fastMode && !manualOpen, (credential) => void scanCredential(credential));
  const form = useContractForm(
    eventScanCaptureIntentForRoomsSchema(targetRooms.map((room) => room.id)),
    {
      operationId,
      operatorUserId,
      deviceId,
      badgeId,
      ...boundedScannedValue(badgeId),
      occurrenceId: targetId,
      roomId,
      action,
      ...(action === "lead" ? { sponsorId, consentConfirmed } : {}),
      observedAt: new Date().toISOString(),
    },
    { deferUntilSubmit: online && !collectorContext && action !== "lead" ? ["badgeId"] : [] },
  );
  const syncHistory = useScannerSyncHistory(operatorUserId, slug);
  const operatorPaused = useRef(false);
  useScannerSessionFence(
    operatorUserId,
    () => {
      authorityPaused.current = true;
      clearCurrentScan();
      eligibilityManifest.current = null;
      setBadge("");
      setConsent(false);
      cancelRetries();
    },
    collectorContext?.sessionId,
  );
  const scannerContext = useRef({ targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms });
  scannerContext.current = { targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms };
  const {
    pending,
    scanSaved,
    pendingReadyScope,
    uploadStatus,
    sync,
    syncing,
    cancelRetries,
    verifyQueuedScan,
    cancelVerification,
  } = useScannerOutboxSync({
    slug,
    operatorUserId,
    collectorContext,
    authorityPaused,
    currentOperation: () => lastOperation.current ?? lastResult?.operationId ?? null,
    presentReceipt,
    setResult,
    setMessage,
    stopCamera: badgeCamera.stop,
    refreshHistory: syncHistory.refresh,
  });
  function clearCurrentScan(message?: string) {
    badgeCamera.stop();
    lastOperation.current = null;
    cancelVerification();
    cooldown.reset();
    clearFeedback();
    if (message) setMessage(message);
  }
  function resetCaptureFields() {
    manual.reset();
    form.reset();
    setBadge("");
    if (action === "lead") setConsent(false);
    setOperation(crypto.randomUUID());
  }
  const auditFailure = useScannerFailureCapture(
    slug,
    () => ({
      operatorUserId,
      deviceId,
      occurrenceId: targetId,
      roomId,
      action,
      ...(action === "lead" ? { sponsorId } : {}),
    }),
    collectorContext,
    {
      saved: scanSaved,
      unsaved: () =>
        failure("This attempt was not saved. Keep the scanned value and retry when device storage is available."),
    },
  );
  const persistCapture = (scan: EventScanRequest) =>
    persistScannerCapture(scan, slug, offlineAdmission.persist, auditFailure);
  function captureAllowed() {
    const blocked = captureClosed.current || authorityPaused.current;
    if (blocked) setMessage(captureClosed.current ? closedMessage : "Sign in again to upload pending scans.");
    return scannerDevice.ready && !blocked;
  }
  async function capture() {
    if (!captureAllowed() || manualCapturePending.current) return;
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
    manualCapturePending.current = true;
    setBusy(true);
    setResult(null);
    try {
      lastOperation.current = checked.data.operationId;
      const saved = await persistCapture(checked.data);
      await scanSaved();
      resetCaptureFields();
      if (!(await presentSavedEligibility(saved, verifyQueuedScan))) {
        if (fastMode) cooldown.feedback();
        return;
      }
      if (fastMode && manualOpen) {
        cooldown.feedback();
        void camera();
      }
    } catch (error) {
      failure(error instanceof Error ? error.message : "Unable to save this scan. Keep the attendee here and retry.");
    } finally {
      manualCapturePending.current = false;
      setBusy(false);
    }
  }
  async function scanCredential(raw: string, fromCamera = false) {
    if (!captureAllowed()) return;
    if (operatorPaused.current || manualPaused.current || manualCapturePending.current) return;
    const current = scannerContext.current;
    if (current.action === "lead" || current.action === "exception") {
      badgeCamera.stop();
      if (fastMode) manualPaused.current = true;
      setBadge(raw);
      manual.setOpen(true);
      manual.setFocusRequested(true);
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
    const operation = parsed.data.operationId;
    lastOperation.current = operation;
    setResult(null);
    showProvisionalMessage(operation, "Checking eligibility…");
    try {
      const saved = await persistCapture(parsed.data);
      await scanSaved();
      if (!(await presentSavedEligibility(saved, verifyQueuedScan))) {
        if (fastMode) cooldown.feedback();
        return;
      }
      resetCaptureFields();
      if (fastMode) cooldown.feedback();
    } catch (error) {
      setBadge(raw);
      if (fastMode) cooldown.feedback();
      if (receiptMatchesOperation(operation, lastOperation.current))
        failure(error instanceof Error ? error.message : "Unable to save scan. Retry.");
    }
  }
  async function camera() {
    if (!captureAllowed() || badgeCamera.starting) return;
    await badgeCamera.start();
  }
  function startScanning() {
    if (!captureAllowed() || !allowedActions.includes(action)) return;
    sound.unlock();
    manualPaused.current = false;
    enterPresentation();
    lastOperation.current = null;
    setResult(null);
    setMessage(scannerStartMessage(manifestReady, Boolean(collectorContext), action));
    setPreview(false);
    setFastMode(true);
    void camera();
  }
  const autoStart = useScannerAutoStart({
    ready: captureReady,
    preparing: manifestPreparing,
    manifest: eligibilityManifest,
    manifestReady,
    targetId,
    roomId,
    onStart: startScanning,
    error: manifestError,
  });
  const preparationStatus = { ...preparation.status, lastSync: syncHistory.lastSync };
  function stopContinuousScanning() {
    autoStart.cancel();
    cancelVerification();
    badgeCamera.stop();
    cooldown.reset();
    lastOperation.current = null;
    setResult(null);
    manual.reset();
    setFastMode(false);
  }
  function showRecentScans() {
    badgeCamera.stop();
    manualPaused.current = true;
    manual.setOpen(false);
    setScannerTab("recent");
  }
  const contextLabel = scannerContextLabel({ ...preparation.location, action, sponsorName });
  const manualControls = {
    handlers: form.handlers,
    action,
    busy,
    ready: captureReady,
    open: manualOpen,
    onCapture: () => void capture(),
    consent:
      action === "lead"
        ? { confirmed: consentConfirmed, field: form.of("consentConfirmed"), onChange: setConsent }
        : undefined,
    onOpen: manual.show,
    onClose: manual.hide,
    entry: {
      focusRequested: manualFocusRequested,
      onFocusHandled: () => manual.setFocusRequested(false),
      badgeId,
      onBadge: setBadge,
      field: form.of("badgeId"),
      lookup: action !== "lead" ? { slug, online: !offline, disabled: busy || !captureReady } : undefined,
    },
  };
  const recentScans = (
    <ScannerRecentScans
      active={recentVisible}
      slug={slug}
      operatorUserId={operatorUserId}
      pending={pending}
      lastSync={syncHistory.lastSync}
    />
  );
  const connection = (
    <ScannerConnectionStatus
      pending={pending}
      online={online}
      syncing={syncing}
      ready={pendingReadyScope === `${slug}:${operatorUserId}`}
      collector={Boolean(collectorContext)}
      uploadStatus={uploadStatus}
      error={failed ? message : scannerDevice.error}
    />
  );
  const mode = {
    action,
    allowedActions,
    sponsorId,
    actionField: form.of("action"),
    onAction: (value: EventScanRequest["action"]) => {
      clearCurrentScan();
      setAction(value);
    },
  };
  return (
    <div ref={scannerShell}>
      <ScannerWorkspace
        hidden={fastMode}
        collector={Boolean(collectorContext)}
        view={scannerTab}
        onView={(view) => {
          if (view === "recent") showRecentScans();
          else {
            badgeCamera.stop();
            manualPaused.current = view !== "scan";
            setScannerTab(view === "diagnostics" ? "diagnostics" : "scan");
          }
        }}
        launch={
          <ScannerLaunchPanel
            connection={connection}
            context={
              collectorContext || action === "lead" || occurrenceId ? { contextLabel, target, timeZone } : undefined
            }
            feedback={
              result || pending > 0 || message !== "Ready to scan"
                ? { result, action, message, pending, status: captureStatus }
                : undefined
            }
            form={form}
            busy={busy}
            capture={() => void capture()}
            pendingStart={autoStart.pending ? manifestError || "Preparing scanner…" : undefined}
            cancelStart={() => autoStart.cancel()}
            controls={
              <ScannerCaptureControls
                collector={collectorContext}
                onCheckSignIn={onCheckSignIn}
                setup={{
                  printHref,
                  operatorUserId,
                  sponsorOnly: action === "lead",
                  explicitTarget: Boolean(occurrenceId),
                  ready: captureReady && pendingReadyScope === `${slug}:${operatorUserId}`,
                  locked:
                    badgeCamera.active ||
                    fastMode ||
                    busy ||
                    cooldown.saving ||
                    cooldown.remainingMs > 0 ||
                    Boolean(lastOperation.current),
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
                mode={mode}
                canStart={captureReady}
                preparing={manifestPreparing || !scannerDevice.ready}
                cameraError={badgeCamera.error}
                start={() => {
                  sound.unlock();
                  if (collectorContext || action === "lead") startScanning();
                  else autoStart.request();
                }}
              >
                <ScannerManualControls {...manualControls} open={manualOpen && !fastMode} />
              </ScannerCaptureControls>
            }
          >
            {!collectorContext && sponsorId && canExportLeads && (
              <ScannerLeadExport slug={slug} sponsorId={sponsorId} />
            )}
          </ScannerLaunchPanel>
        }
        diagnostics={
          <ScannerDiagnosticsView
            preferences={preferences}
            sound={sound}
            context={{ sessionId: portalSession.value?.sessionId, slug, operatorUserId, sponsorId }}
            scanner={scannerDevice}
            sync={sync}
            refreshEligibility={preparation.eligibility.refresh}
            onMessage={setMessage}
            onCapturePause={(paused) => {
              if (paused) badgeCamera.stop();
              operatorPaused.current = paused;
            }}
            status={{
              pending,
              uploadStatus,
              collector: collectorContext,
              offline: offlinePreparation,
              action,
              syncing,
            }}
            preparation={preparationStatus}
            unverifiedStart={
              captureReady && action !== "lead" && !manifestReady && !manifestPreparing ? startScanning : undefined
            }
          />
        }
        recent={!fastMode && recentScans}
      />
      {fastMode && (
        <FastScannerView
          presentation={presentation}
          onPresentation={togglePresentation}
          canRecordAttendance={!collectorContext && allowedActions.includes("attendance")}
          context={contextLabel}
          lastResult={lastResult}
          connectionStatus={connection}
          soundLabel={sound.label}
          onTourSound={sound.test}
          onSound={() => sound.toggle(preferences.setSound)}
          result={result}
          status={captureStatus}
          preparation={collectorContext ? undefined : preparationStatus}
          mode={action}
          pending={pending}
          message={message}
          uploadStatus={uploadStatus}
          cooldown={{ ...cooldown, saving: cooldown.saving || busy }}
          screenAwake={screenAwake}
          onOperatorPause={(paused) => {
            operatorPaused.current = paused;
          }}
          cameraActive={badgeCamera.active}
          cameraStarting={badgeCamera.starting}
          cameraError={badgeCamera.error}
          onCameraRetry={() => void camera()}
          onManual={manualControls.onOpen}
          manualEntry={manualOpen ? <ScannerManualControls {...manualControls} inline /> : undefined}
          onRecentScans={collectorContext ? undefined : showRecentScans}
          recentScans={recentVisible ? recentScans : undefined}
          onReturnToScanning={() => {
            manualPaused.current = false;
            setScannerTab("scan");
            void camera();
          }}
          preview={preview}
          onPreview={() => setPreview(!preview)}
          onExit={stopContinuousScanning}
        />
      )}
      <ScannerCamera
        video={badgeCamera.video}
        cameraActive={badgeCamera.active}
        fastMode={fastMode && presentation === "fullscreen"}
        preview={preview}
      />
    </div>
  );
}
