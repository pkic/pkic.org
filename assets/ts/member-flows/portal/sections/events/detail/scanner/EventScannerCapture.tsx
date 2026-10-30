import { useScannerManualEntry } from "./useScannerManualEntry";
import { ScannerDiagnosticsView } from "./ScannerDiagnosticsView";
import { useScannerFeedback } from "./useScannerFeedback";
import { badgeCredentialSchema } from "../../../../../../../shared/schemas/badge-credential";
import { boundedScannedValue } from "../../../../../../../shared/schemas/scanner-attempt-capture";
import { useScannerFailureCapture, persistScannerCapture } from "./useScannerFailureCapture";
import type { EventScannerProps } from "./EventScanner";
import { Tabs } from "../../../../../../components/Tabs";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { ScannerCaptureContext, scannerContextLabel } from "./ScannerCaptureContext";
import { scannerInitialAction } from "./ScannerModeSelect";
import { ScannerSyncStatus } from "./ScannerPreparationStatus";
import { portalSession } from "../../../../state";
import { useScannerSessionFence } from "./useScannerSessionFence";
import { ScannerLeadExport } from "./ScannerLeadExport";
import { useScannerDevice } from "./useScannerDevice";
import { useScannerHardware } from "./useScannerHardware";
import { ScannerCaptureControls, ScannerManualControls, scannerStartMessage } from "./ScannerCaptureControls";
import { useScannerLocation } from "./useScannerLocation";
import { ScannerCamera } from "./ScannerCamera";
import { ScannerRecentScans } from "./ScannerRecentScans";
import { useOfflineAdmission } from "./useOfflineAdmission";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  scanActionSchema,
  eventScanCaptureIntentForRoomsSchema,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { receiptMatchesOperation, unknownScanResponse } from "./scan-stream";
import { useScannerCamera } from "./useScannerCamera";
import { pendingScanCount } from "./scan-outbox";
import { useScannerOutboxSync } from "./useScannerOutboxSync";
import "./EventScanner.css";
import { FastScannerView } from "./FastScannerView";
import { enterScannerFullscreen, scannerImmersiveLifecycle } from "./immersive-scanner";
import { useEligibilityManifest, useScannerOfflinePreparation } from "./useEligibilityManifest";
import { ScannerFeedback } from "./ScannerFeedback";
import { useScanCooldown } from "./useScanCooldown";
import { useScannerSyncHistory } from "./useScannerSyncHistory";
import { scannerPreparationRefusal } from "./scanner-offline-context";
export function EventScannerCapture({
  slug,
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
  const [action, setAction] = useState<EventScanRequest["action"]>(
    scannerInitialAction(allowedActions, collectorContext?.action, Boolean(sponsorId)),
  );
  const [scannerTab, setScannerTab] = useHashQueryParam("scannerTab", "scan", ["scan", "recent", "diagnostics"]);
  const recentVisible = scannerTab === "recent" && !collectorContext;
  const diagnosticsVisible = scannerTab === "diagnostics" && !collectorContext;
  const [consentConfirmed, setConsent] = useState(false);
  const lastOperation = useRef<string | null>(null);
  const lastCommittedOperation = useRef<string | null>(null);
  const lastBadge = useRef("");
  const scannerDevice = useScannerDevice(slug, operatorUserId, sponsorId, collectorContext);
  const { deviceId } = scannerDevice;
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const authorityPaused = useRef(false);
  const [fastMode, setFastMode] = useState(false);
  const [feedbackPause, setFeedbackPause] = useState(600);
  const {
    result,
    setResult,
    message,
    setMessage,
    showProvisionalMessage,
    presentReceipt,
    showLocalEligibility,
    failure,
  } = useScannerFeedback({
    enabled: fastMode,
    durationMs: feedbackPause,
    collector: Boolean(collectorContext),
    currentOperation: lastOperation,
    committedOperation: lastCommittedOperation,
    authorityPaused,
  });
  const [busy, setBusy] = useState(false);
  const manualCapturePending = useRef(false);
  const [screenAwake, setScreenAwake] = useState(false);
  const cooldown = useScanCooldown(feedbackPause);
  const [preview, setPreview] = useState(false);
  const scannerShell = useRef<HTMLDivElement>(null);
  const badgeCamera = useScannerCamera((raw) => void scanCredential(raw, true));
  const manual = useScannerManualEntry(fastMode, badgeCamera.stop, () => void camera());
  const { open: manualOpen, focusRequested: manualFocusRequested, paused: manualPaused } = manual;
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
  } = useScannerLocation(slug, occurrenceId, action !== "lead", clearCurrentScan, collectorContext);
  const { eligibilityManifest, manifestReady, manifestPreparing, manifestError } = useEligibilityManifest(
    slug,
    operatorUserId,
    targetId,
    action,
    () => {
      refusePreparation();
      authorityPaused.current = true;
      clearCurrentScan();
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
    const release = scannerImmersiveLifecycle(
      scannerShell.current,
      () => {
        manualPaused.current = false;
        manual.setOpen(false);
        setFastMode(false);
      },
      setScreenAwake,
    );
    return () => {
      badgeCamera.stop();
      cooldown.reset();
      release();
    };
  }, [fastMode]);
  useScannerHardware(fastMode && !manualOpen, (credential) => void scanCredential(credential));
  const form = useContractForm(eventScanCaptureIntentForRoomsSchema(targetRooms.map((room) => room.id)), {
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
  });
  const syncHistory = useScannerSyncHistory(operatorUserId, slug);
  const operatorPaused = useRef(false);
  useScannerSessionFence(
    operatorUserId,
    () => {
      authorityPaused.current = true;
      clearCurrentScan();
      lastBadge.current = "";
      eligibilityManifest.current = null;
      setBadge("");
      setConsent(false);
      cancelRetries();
    },
    collectorContext?.sessionId,
  );
  const scannerContext = useRef({ targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms });
  scannerContext.current = { targetId, action, operatorUserId, deviceId, roomId, rooms: targetRooms };
  const { pending, setPending, pendingReadyScope, uploadStatus, setUploadStatus, sync, syncing, cancelRetries } =
    useScannerOutboxSync({
      slug,
      operatorUserId,
      collectorContext,
      authorityPaused,
      currentOperation: () => lastOperation.current,
      presentReceipt,
      setResult,
      setMessage,
      stopCamera: badgeCamera.stop,
      refreshHistory: syncHistory.refresh,
    });
  /** Leave the displayed scan: no camera stream, no operation awaiting a receipt, no result on screen. */
  function clearCurrentScan() {
    badgeCamera.stop();
    lastOperation.current = null;
    setResult(null);
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
      saved: async () => {
        setPending(await pendingScanCount(operatorUserId));
        void sync();
      },
      unsaved: () =>
        failure("This attempt was not saved. Keep the scanned value and retry when device storage is available."),
    },
  );
  const persistCapture = (scan: EventScanRequest) =>
    persistScannerCapture(scan, slug, offlineAdmission.persist, auditFailure);
  async function capture() {
    if (!scannerDevice.ready || manualCapturePending.current) return;
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
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
      lastBadge.current = checked.data.badgeId;
      lastOperation.current = checked.data.operationId;
      const saved = await persistCapture(checked.data);
      setUploadStatus(collectorContext ? "Saved offline · not yet verified" : "Uploading scans in the background…");
      setPending(await pendingScanCount(operatorUserId));
      showProvisionalMessage(saved.scan.operationId, "Scan saved. Checking eligibility…");
      showLocalEligibility(saved.scan, saved.local);
      void sync();
      resetCaptureFields();
      if (fastMode && manualOpen) {
        manualPaused.current = false;
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
    if (!scannerDevice.ready || authorityPaused.current || operatorPaused.current || manualPaused.current) return;
    const current = scannerContext.current;
    if (current.action === "lead" || current.action === "exception") {
      badgeCamera.stop();
      if (fastMode) manualPaused.current = true;
      setBadge(raw);
      manual.setOpen(true);
      manual.setFocusRequested(true);
      lastBadge.current = raw;
      badgeCamera.stop();
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
    lastBadge.current = parsed.data.badgeId;
    setResult(null);
    showProvisionalMessage(operation, "Checking eligibility…");
    try {
      const saved = await persistCapture(parsed.data);
      setUploadStatus(collectorContext ? "Saved offline · not yet verified" : "Uploading scans in the background…");
      setPending(await pendingScanCount(operatorUserId));
      showLocalEligibility(saved.scan, saved.local);
      resetCaptureFields();
      if (fastMode) cooldown.feedback();
      void sync();
    } catch (error) {
      setBadge(raw);
      if (fastMode) cooldown.feedback();
      if (receiptMatchesOperation(operation, lastOperation.current))
        failure(error instanceof Error ? error.message : "Unable to save scan. Retry.");
    }
  }
  async function camera() {
    if (!scannerDevice.ready || badgeCamera.starting) return;
    if (authorityPaused.current) {
      setMessage("Sign in again to upload pending scans.");
      return;
    }
    await badgeCamera.start();
  }
  function startScanning() {
    manualPaused.current = false;
    if (!allowedActions.includes(action) || !scannerDevice.ready) return;
    if (scannerShell.current) enterScannerFullscreen(scannerShell.current);
    lastOperation.current = null;
    setResult(null);
    setMessage(scannerStartMessage(manifestReady, Boolean(collectorContext), action));
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
  function stopContinuousScanning() {
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
  useEffect(() => {
    if (recentVisible) {
      badgeCamera.stop();
      manualPaused.current = true;
    }
  }, [recentVisible]);
  const contextLabel = scannerContextLabel({ action, sponsorName, targetId, targetLabel, roomId, rooms: targetRooms });
  const manualControls = {
    action,
    busy,
    ready: scannerDevice.ready,
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
  return (
    <div ref={scannerShell}>
      <div class="pk-stack" hidden={fastMode}>
        {!collectorContext && (
          <Tabs
            label="Badge scanner views"
            idPrefix="scanner-view"
            active={scannerTab}
            onChange={(view) => {
              if (view === "recent") showRecentScans();
              else {
                badgeCamera.stop();
                manualPaused.current = view !== "scan";
                setScannerTab(view === "diagnostics" ? "diagnostics" : "scan");
              }
            }}
            items={[
              { key: "scan", label: "Setup", panelId: "scanner-scan-panel" },
              { key: "recent", label: "Recent scans", panelId: "scanner-recent-panel" },
              { key: "diagnostics", label: "Diagnostics", panelId: "scanner-diagnostics-panel" },
            ]}
          />
        )}
        <div
          id="scanner-scan-panel"
          role="tabpanel"
          aria-labelledby={collectorContext ? undefined : "scanner-view-scan"}
          hidden={recentVisible || diagnosticsVisible}
        >
          <Panel>
            <PanelHeader title="Scanner setup" />
            <PanelBody>
              <ScannerCaptureContext contextLabel={contextLabel} target={target} timeZone={timeZone} />
              {(result || pending > 0 || message !== "Ready to scan") && (
                <ScannerFeedback compact result={result} action={action} message={message} pending={pending} />
              )}
              <form
                class="pk-form"
                noValidate
                aria-busy={busy}
                {...form.handlers}
                onSubmit={(event) => {
                  event.preventDefault();
                  void capture();
                }}
              >
                <ScannerCaptureControls
                  collector={collectorContext}
                  onCheckSignIn={onCheckSignIn}
                  setup={{
                    operatorUserId,
                    sponsorOnly: action === "lead",
                    explicitTarget: Boolean(occurrenceId),
                    ready: pendingReadyScope === `${slug}:${operatorUserId}`,
                    locked:
                      badgeCamera.active ||
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
                      clearCurrentScan();
                      setAction(value);
                    },
                  }}
                  canStart={
                    scannerDevice.ready &&
                    Boolean(collectorContext || action === "lead" || (manifestReady && !manifestPreparing))
                  }
                  preparing={manifestPreparing || !scannerDevice.ready}
                  cameraError={badgeCamera.error}
                  start={startScanning}
                >
                  <ScannerManualControls {...manualControls} open={manualOpen && !fastMode} />
                </ScannerCaptureControls>
              </form>
              <ScannerSyncStatus
                pending={pending}
                lastSync={syncHistory.lastSync}
                uploadStatus={uploadStatus}
                collector={collectorContext}
                offline={offlinePreparation}
                action={action}
                syncing={syncing}
                sync={collectorContext ? undefined : () => void sync()}
              />
              {!collectorContext && sponsorId && canExportLeads && (
                <ScannerLeadExport slug={slug} sponsorId={sponsorId} />
              )}
            </PanelBody>
          </Panel>
        </div>
        {diagnosticsVisible && (
          <div id="scanner-diagnostics-panel" role="tabpanel" aria-labelledby="scanner-view-diagnostics">
            <ScannerDiagnosticsView
              context={{ sessionId: portalSession.value?.sessionId, slug, operatorUserId, sponsorId }}
              scanner={scannerDevice}
              sync={sync}
              onMessage={setMessage}
              onCapturePause={(paused) => {
                if (paused) badgeCamera.stop();
                operatorPaused.current = paused;
              }}
              pacing={{ value: feedbackPause, onChange: setFeedbackPause }}
              preparation={preparation}
              unverifiedStart={action !== "lead" && !manifestReady && !manifestPreparing ? startScanning : undefined}
            />
          </div>
        )}
        {!collectorContext && (
          <div id="scanner-recent-panel" role="tabpanel" aria-labelledby="scanner-view-recent" hidden={!recentVisible}>
            {!fastMode && recentScans}
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
        fastMode={fastMode}
        preview={preview}
      />
    </div>
  );
}
