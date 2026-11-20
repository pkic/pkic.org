import { createScannerCaptureActions } from "./createScannerCaptureActions";
import { useBadgeCollection } from "./useBadgeCollection";
import { useScannerCapturePause } from "./useScannerCapturePause";
import { useScannerManualEntry } from "./useScannerManualEntry";
import { useScannerFeedback } from "./useScannerFeedback";
import { boundedScannedValue } from "../../../../../../../shared/schemas/scanner-attempt-capture";
import { useScannerFailureCapture, persistScannerCapture } from "./useScannerFailureCapture";
import type { EventScannerProps } from "./EventScanner";
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
import { useScannerDevice } from "./useScannerDevice";
import { useScannerHardware } from "./useScannerHardware";
import { scannerManualControlProps, scannerStartMessage } from "./ScannerCaptureControls";
import { useScannerPreparation } from "./useScannerPreparation";
import { ScannerRecentScans } from "./ScannerRecentScans";
import { useRef, useState } from "preact/hooks";
import {
  scanActionSchema,
  eventScanCaptureIntentForRoomsSchema,
  type EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useScannerCamera } from "./useScannerCamera";
import { useScannerOutboxSync } from "./useScannerOutboxSync";
import { useScannerPresentation } from "./useScannerPresentation";
import { useScanCooldown } from "./useScanCooldown";
import { useScannerSyncHistory } from "./useScannerSyncHistory";
import { scannerPreparationRefusal } from "./scanner-offline-context";
import { useScannerCaptureLifecycle } from "./useScannerCaptureLifecycle";
import { useBadgeCollectionPrinting } from "./useBadgeCollectionPrinting";
import { useSponsorLeadConfirmation } from "./useSponsorLeadConfirmation";
export function useEventScannerCaptureController({
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
  const [leadRunStarted, setLeadRunStarted] = useState(false);
  const lastOperation = useRef<string | null>(null);
  const lastCommittedOperation = useRef<string | null>(null);
  const scannerDevice = useScannerDevice(slug, operatorUserId, sponsorId, collectorContext);
  const { deviceId } = scannerDevice;
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const authorityPaused = useRef(false);
  const [fastMode, setFastMode] = useScannerCaptureActive();
  const preferences = useScannerPreferences();
  const {
    result,
    lastResult,
    clearFeedback,
    failed,
    needsAdvance,
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
    holdEligible: action === "lead",
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
  const { open: manualOpen, paused: manualPaused } = manual;
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
  useScannerHardware(
    fastMode && !manualOpen && (action !== "lead" || consentConfirmed),
    (credential) => void scanCredential(credential),
  );
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
  const {
    confirmation: leadConfirmation,
    showReceipt,
    clearConfirmation,
  } = useSponsorLeadConfirmation({
    action,
    slug,
    sponsorId,
    collector: Boolean(collectorContext),
    online,
    authorityPaused,
    lastOperation,
    presentReceipt,
  });
  const capturePause = useScannerCapturePause(badgeCamera.stop, () => autoStart.cancel());
  useScannerSessionFence(
    operatorUserId,
    () => {
      authorityPaused.current = true;
      clearCurrentScan();
      setMessage("Sign in again to upload pending scans.");
      eligibilityManifest.current = null;
      setBadge("");
      setConsent(false);
      setLeadRunStarted(false);
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
    presentReceipt: showReceipt,
    setResult,
    setMessage,
    stopCamera: badgeCamera.stop,
    refreshHistory: syncHistory.refresh,
  });
  function clearCurrentScan(message?: string, stopCamera = true) {
    if (stopCamera) badgeCamera.stop();
    collectionPrinting.clear();
    collection.clear();
    lastOperation.current = null;
    cancelVerification();
    cooldown.reset();
    clearFeedback();
    clearConfirmation();
    if (message) setMessage(message);
  }
  function resetCaptureFields() {
    manual.reset();
    form.reset();
    setBadge("");
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
    if (action === "lead" && needsAdvance) return false;
    if (!captureAllowed()) {
      if (closedMessage || authorityPaused.current)
        setMessage(closedMessage || "Sign in again to upload pending scans.");
      return false;
    }
    return action !== "lead" || consentConfirmed;
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
    feedbackHeld: needsAdvance,
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
    consentConfirmed,
    showProvisionalMessage,
  });
  async function camera(permissionAcknowledged = consentConfirmed) {
    if ((action === "lead" && !permissionAcknowledged) || !captureReady || badgeCamera.starting) return;
    if (closedMessage || authorityPaused.current) return;
    await badgeCamera.start();
  }
  function startScanning() {
    if (!requestCapture() || !allowedActions.includes(action)) return;
    if (action === "lead") setLeadRunStarted(true);
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
  useScannerCaptureLifecycle({ fastMode, collectorContext, ready: captureReady, start: startScanning });
  const preparationStatus = { ...preparation.status, lastSync: syncHistory.lastSync };
  function nextCollectionAttendee() {
    if (busy || cooldown.saving || collectionPrinting.busy) return;
    clearCurrentScan("Ready to scan", false);
    manualPaused.current = false;
    resetCaptureFields();
    if (fastMode && !badgeCamera.active) void camera();
  }
  function stopContinuousScanning() {
    if (action === "lead") {
      setConsent(false);
      setLeadRunStarted(false);
    }
    clearConfirmation();
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
        result?.outcome === "eligible" && collectionPrinting.available ? collectionPrinting.print : undefined,
        result?.outcome,
      )
    : undefined;
  const contextLabel = scannerContextLabel({ ...preparation.location, action, sponsorName, badgeCollection });
  const manualControls = scannerManualControlProps({
    form,
    action,
    busy,
    ready: captureReady,
    manual,
    badgeId,
    onBadge: setBadge,
    onCapture: () => void capture(),
    consentConfirmed,
    onConsent: setConsent,
    onOpen: () => {
      if (action === "lead") setLeadRunStarted(true);
      manual.show();
    },
    slug,
    offline,
  });
  const recentScans = (
    <ScannerRecentScans
      active={recentVisible}
      slug={slug}
      operatorUserId={operatorUserId}
      pending={pending}
      lastSync={syncHistory.lastSync}
    />
  );
  const uploadState = { pending, online, syncing, uploadStatus };
  const connection = (
    <ScannerConnectionStatus
      compact={fastMode}
      {...uploadState}
      ready={pendingReadyScope === `${slug}:${operatorUserId}`}
      collector={Boolean(collectorContext)}
      error={failed ? message : scannerDevice.error}
      offlinePrepared={Boolean(collectorContext || preparation.offlinePreparation.context)}
      preparation={fastMode && action !== "lead" ? preparationStatus : undefined}
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
  return {
    workspace: {
      scannerShell,
      fastMode,
      collectorContext,
      scannerTab,
      showRecentScans,
      badgeCamera,
      manualPaused,
      setScannerTab,
      contextLabel,
      connection,
    },
    captureState: {
      action,
      occurrenceId,
      target,
      timeZone,
      result,
      pending,
      message,
      setMessage,
      captureStatus,
      leadConfirmation,
      form,
      busy,
      capture,
      autoStart,
    },
    deviceState: {
      preparation,
      scannerDevice,
      onSignIn,
      printHref,
      operatorUserId,
      sponsorId,
      allowedActions,
      clearCurrentScan,
      selectTarget,
      setAction,
      setPurpose,
      sound,
      badgeCollection,
    },
    readiness: {
      manifestReady,
      manifestPreparing,
      captureReady,
      pendingReadyScope,
      slug,
      cooldown,
      lastOperation,
      targetId,
      targetLabel,
      roomId,
      targetRooms,
      setTimeZone,
      selectRoom,
    },
    controls: {
      mode,
      consentConfirmed,
      leadRunStarted,
      setConsent,
      needsAdvance,
      nextCollectionAttendee,
      startScanning,
      collection,
      manualControls,
      manualOpen,
      recentVisible,
      collectionDisplay,
      canExportLeads,
    },
    status: {
      preferences,
      sync,
      capturePause,
      preparationStatus,
      uploadState,
      recentScans,
      presentation,
      togglePresentation,
      lastResult,
      uploadStatus,
      screenAwake,
      preview,
      setPreview,
      camera,
      stopContinuousScanning,
      offline,
      collectionPrinting,
    },
  };
}
