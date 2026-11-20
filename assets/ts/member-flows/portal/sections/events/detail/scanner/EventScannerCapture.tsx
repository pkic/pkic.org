import { ScannerCollectionAttendee } from "./ScannerCollectionAttendee";
import { createScannerCaptureActions } from "./createScannerCaptureActions";
import { useBadgeCollection } from "./useBadgeCollection";
import { useScannerCapturePause } from "./useScannerCapturePause";
import { useScannerManualEntry } from "./useScannerManualEntry";
import { ScannerDiagnosticsView } from "./ScannerDiagnosticsView";
import { useScannerFeedback } from "./useScannerFeedback";
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
import { useEffect, useRef, useState } from "preact/hooks";
import {
  scanActionSchema,
  eventScanCaptureIntentForRoomsSchema,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { ScannerLaunchPanel } from "./ScannerLaunchPanel";
import { useScannerCamera } from "./useScannerCamera";
import { useScannerOutboxSync } from "./useScannerOutboxSync";
import "./EventScanner.css";
import { FastScannerView } from "./FastScannerView";
import { useScannerPresentation } from "./useScannerPresentation";
import { useScanCooldown } from "./useScanCooldown";
import { useScannerSyncHistory } from "./useScannerSyncHistory";
import { scannerCaptureActive, scannerPreparationRefusal } from "./scanner-offline-context";
import { useBadgeCollectionPrinting } from "./useBadgeCollectionPrinting";
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
  onSignIn,
}: EventScannerProps) {
  const refusePreparation = scannerPreparationRefusal(portalSession.value, operatorUserId);
  const [badgeId, setBadge] = useState("");
  const [action, setAction] = useScannerAction(allowedActions, collectorContext?.action, !!sponsorId);
  const [scannerTab, setScannerTab] = useHashQueryParam("scannerTab", "scan", ["scan", "recent", "diagnostics"]);
  const recentVisible = scannerTab === "recent" && !collectorContext;
  const [selectedPurpose, setPurpose] = useHashQueryParam("scannerPurpose", "scan", ["scan", "collection"]);
  const badgeCollection =
    !sponsorId && action === "attendance" && (collectorContext?.purpose ?? selectedPurpose) === "collection";
  const online = useScannerConnection();
  const collectionPrinting = useBadgeCollectionPrinting(slug, Boolean(printHref && !collectorContext), online);
  const collectionManifest = useRef<import("./eligibility-manifest").EligibilityManifest | null>(null);
  const collection = useBadgeCollection(
    badgeCollection,
    collectionManifest,
    `${slug}:${operatorUserId}:${collectorContext?.sessionId ?? portalSession.value?.sessionId}:${action}`,
    () => collectionPrinting.active,
  );
  const [consentConfirmed, setConsent] = useState(false);
  const lastOperation = useRef<string | null>(null);
  const lastCommittedOperation = useRef<string | null>(null);
  const scannerDevice = useScannerDevice(slug, operatorUserId, sponsorId, collectorContext);
  const { deviceId } = scannerDevice;
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const authorityPaused = useRef(false);
  const [fastMode, setFastMode] = useScannerCaptureActive();
  useEffect(() => {
    scannerCaptureActive.value = fastMode;
    return () => {
      scannerCaptureActive.value = false;
    };
  }, [fastMode]);
  const preferences = useScannerPreferences();
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
    enabled: fastMode && !badgeCollection,
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
    allowedActions,
    badgeCollection,
    collectorContext,
    epoch: scannerDevice.epoch,
    session: portalSession.value,
    onContextChange: clearCurrentScan,
    onPreparationClosed: (code) => {
      autoStart.cancel();
      if (code === "SCANNER_PREPARATION_CLOSED" || code === "SCANNER_PREPARATION_CLOSING")
        void scannerDevice.reconcile();
    },
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
  const { eligibilityManifest, manifestReady, manifestPreparing, closedMessage } = preparation.eligibility;
  collectionManifest.current = eligibilityManifest.current;
  const captureReady = scannerDevice.ready && !closedMessage;
  const sound = useScannerSound(preferences.sound, result ?? lastResult, action, failed, Boolean(targetId));
  const screenAwake = useScannerImmersiveLifecycle(
    fastMode,
    scannerShell,
    () => {
      if (collectionPrinting.active) return;
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
  const capturePause = useScannerCapturePause(badgeCamera.stop, () => autoStart.cancel());
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
    collectionPrinting.clear();
    collection.clear();
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
    persistScannerCapture(scan, slug, preparation.offlineAdmission.persist, auditFailure);
  const captureAllowed = () =>
    scannerDevice.ready &&
    !closedMessage &&
    !authorityPaused.current &&
    (!badgeCollection || manifestReady || Boolean(collectorContext));
  function requestCapture() {
    if (captureAllowed()) return true;
    if (closedMessage || authorityPaused.current) setMessage(closedMessage || "Sign in again to upload pending scans.");
    return false;
  }
  const { capture, scanCredential } = createScannerCaptureActions({
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
    manualOpen,
    cooldown,
    camera,
    failure,
    operatorPaused: capturePause.paused,
    manualPaused,
    scannerContext,
    badgeCamera,
    manual,
    setBadge,
    setFastMode,
    setConsent,
    showProvisionalMessage,
  });
  async function camera() {
    if (!requestCapture() || badgeCamera.starting) return;
    await badgeCamera.start();
  }
  function startScanning() {
    if (!requestCapture() || !allowedActions.includes(action)) return;
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
    error: preparation.status.error,
    allowUnverified: !badgeCollection,
  });
  const collectorStarted = useRef(false);
  const startCollector = useRef(startScanning);
  startCollector.current = startScanning;
  useEffect(() => {
    if (!collectorContext || !captureReady || collectorStarted.current) return;
    collectorStarted.current = true;
    startCollector.current();
  }, [collectorContext, captureReady]);
  const preparationStatus = { ...preparation.status, lastSync: syncHistory.lastSync };
  function nextCollectionAttendee() {
    if (busy || cooldown.saving || collectionPrinting.busy) return;
    collectionPrinting.clear();
    collection.clear();
    lastOperation.current = null;
    cancelVerification();
    clearFeedback();
    setMessage("Ready to scan");
    cooldown.reset();
    manualPaused.current = false;
    manual.setOpen(false);
    if (fastMode && !badgeCamera.active) void camera();
  }
  function stopContinuousScanning() {
    collectionPrinting.clear();
    collection.clear();
    autoStart.cancel();
    cancelVerification();
    badgeCamera.stop();
    cooldown.reset();
    lastOperation.current = null;
    setResult(null);
    if (!result && !failed && message === scannerStartMessage(false, false, action)) setMessage("Ready to scan");
    manual.reset();
    setFastMode(false);
  }
  function showRecentScans() {
    badgeCamera.stop();
    manualPaused.current = true;
    manual.setOpen(false);
    setScannerTab("recent");
  }
  const collectionDisplay = badgeCollection
    ? collection.display(
        nextCollectionAttendee,
        busy || cooldown.saving || collectionPrinting.busy,
        collectionPrinting.available ? collectionPrinting.print : undefined,
      )
    : undefined;
  const contextLabel = scannerContextLabel({ ...preparation.location, action, sponsorName, badgeCollection });
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
      compact={fastMode}
      pending={pending}
      online={online}
      syncing={syncing}
      ready={pendingReadyScope === `${slug}:${operatorUserId}`}
      collector={Boolean(collectorContext)}
      uploadStatus={uploadStatus}
      error={failed ? message : scannerDevice.error}
      offlinePrepared={Boolean(collectorContext || preparation.offlinePreparation.context)}
      preparation={fastMode ? preparationStatus : undefined}
    />
  );
  const mode = {
    action,
    allowedActions,
    sponsorId,
    actionField: form.of("action"),
    onAction: (value: EventScanRequest["action"]) => {
      clearCurrentScan();
      setPurpose("scan");
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
            title={collectorContext ? contextLabel : undefined}
            connection={connection}
            context={
              !collectorContext && (action === "lead" || occurrenceId) ? { contextLabel, target, timeZone } : undefined
            }
            feedback={
              result || pending > 0 || message !== "Ready to scan"
                ? { result, action, message, pending, status: captureStatus }
                : undefined
            }
            form={form}
            busy={busy}
            capture={() => void capture()}
            pendingStart={autoStart.pending ? preparation.status : undefined}
            devicePreparation={{ ready: scannerDevice.ready, error: scannerDevice.error }}
            cancelStart={() => autoStart.cancel()}
            retryStart={() => (scannerDevice.error ? scannerDevice.retry() : void preparation.eligibility.refresh())}
            controls={
              <ScannerCaptureControls
                collector={collectorContext}
                onSignIn={onSignIn}
                setup={{
                  printHref,
                  operatorUserId,
                  onCollection:
                    !sponsorId && allowedActions.includes("attendance")
                      ? () => {
                          clearCurrentScan();
                          selectTarget(null);
                          setAction("attendance");
                          setPurpose("collection");
                          sound.unlock();
                          autoStart.request();
                          if (badgeCollection && !manifestReady && !manifestPreparing)
                            void preparation.eligibility.refresh();
                        }
                      : undefined,
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
                preparing={!scannerDevice.ready}
                cameraError={badgeCamera.error}
                start={() => {
                  sound.unlock();
                  if (collectorContext || action === "lead") startScanning();
                  else autoStart.request();
                }}
              >
                {!collection.waiting && <ScannerManualControls {...manualControls} open={manualOpen && !fastMode} />}
              </ScannerCaptureControls>
            }
          >
            {!fastMode && collectionDisplay?.waiting && (
              <ScannerCollectionAttendee {...collectionDisplay} onAdvance={nextCollectionAttendee} />
            )}
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
            onCapturePause={capturePause.pauseSession}
            status={{
              pending,
              uploadStatus,
              collector: collectorContext,
              offline: preparation.offlinePreparation,
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
          collection={collectionDisplay}
          taskSwitchDisabled={busy || cooldown.saving}
          presentation={presentation}
          onPresentation={togglePresentation}
          canRecordAttendance={!collectorContext && allowedActions.includes("attendance")}
          context={contextLabel}
          lastResult={lastResult}
          connectionStatus={connection}
          operatorControls={
            collectorContext && onSignIn ? (
              <Button type="button" variant="secondary" onClick={onSignIn}>
                Sign in
              </Button>
            ) : undefined
          }
          soundLabel={sound.label}
          onTourSound={sound.test}
          onSound={() => sound.toggle(preferences.setSound)}
          result={result}
          status={collectionPrinting.status ?? captureStatus}
          preparation={collectorContext ? undefined : preparationStatus}
          mode={action}
          pending={pending}
          message={message}
          uploadStatus={uploadStatus}
          cooldown={{ ...cooldown, saving: cooldown.saving || busy }}
          screenAwake={screenAwake}
          onOperatorPause={capturePause.setPaused}
          cameraActive={badgeCamera.active}
          cameraStarting={badgeCamera.starting}
          cameraError={badgeCamera.error}
          onCameraRetry={collection.waiting ? undefined : () => void camera()}
          onManual={collection.waiting ? undefined : manualControls.onOpen}
          manualLabel={offline ? "Enter badge code" : undefined}
          manualEntry={manualOpen ? <ScannerManualControls {...manualControls} inline /> : undefined}
          onRecentScans={collectorContext || badgeCollection ? undefined : showRecentScans}
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
      {collectionPrinting.job}
    </div>
  );
}
