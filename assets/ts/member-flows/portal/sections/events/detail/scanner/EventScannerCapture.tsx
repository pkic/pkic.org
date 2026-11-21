import { ScannerCollectionAttendee } from "./ScannerCollectionAttendee";
import { ScannerDiagnosticsView } from "./ScannerDiagnosticsView";
import { ScannerWorkspace } from "./ScannerWorkspace";
import { ScannerCaptureControls, ScannerManualControls, ScannerOfflineSignInButton } from "./ScannerCaptureControls";
import { ScannerCamera } from "./ScannerCamera";
import { ScannerLaunchPanel } from "./ScannerLaunchPanel";
import { FastScannerView } from "./FastScannerView";
import { portalSession } from "../../../../state";
import type { EventScannerProps } from "./EventScanner";
import { useEventScannerCaptureController } from "./useEventScannerCaptureController";
import "./EventScanner.css";

export function EventScannerCapture(props: EventScannerProps) {
  const { workspace, captureState, deviceState, readiness, controls, status } = useEventScannerCaptureController(props);
  const {
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
  } = workspace;
  const {
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
  } = captureState;
  const {
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
  } = deviceState;
  const {
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
  } = readiness;
  const {
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
  } = controls;
  const {
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
  } = status;
  const leadSetup = action === "lead" && !fastMode && !leadRunStarted;
  const leadStatusNeeded = action !== "lead" || (!result && (offline || pending > 0));
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
            title={
              action === "lead"
                ? leadSetup
                  ? "Before you start"
                  : "Sponsor leads"
                : collectorContext
                  ? contextLabel
                  : undefined
            }
            connection={leadStatusNeeded ? connection : null}
            connectionBelow={action === "lead"}
            context={
              !collectorContext && action === "lead" && props.sponsorName
                ? { contextLabel: props.sponsorName, target: null, timeZone: null, quiet: true }
                : !collectorContext && occurrenceId
                  ? { contextLabel, target, timeZone }
                  : undefined
            }
            feedback={
              result || message !== "Ready to scan" || (action !== "lead" && pending > 0)
                ? {
                    result,
                    action,
                    message,
                    pending,
                    status: captureStatus,
                    leadConfirmation: leadConfirmation?.operationId === result?.operationId ? leadConfirmation : null,
                  }
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
                  ready:
                    captureReady &&
                    pendingReadyScope === `${slug}:${operatorUserId}` &&
                    (action !== "lead" || consentConfirmed),
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
                leadConsent={
                  leadSetup
                    ? { confirmed: consentConfirmed, field: form.of("consentConfirmed"), onChange: setConsent }
                    : undefined
                }
                leadConsentConfirmed={consentConfirmed}
                leadNeedsAdvance={action === "lead" && needsAdvance}
                onNextLead={nextCollectionAttendee}
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
              ...uploadState,
              collector: collectorContext,
              offline: preparation.offlinePreparation,
              action,
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
          needsAdvance={needsAdvance}
          leadConsentConfirmed={consentConfirmed}
          leadConfirmation={leadConfirmation?.operationId === result?.operationId ? leadConfirmation : null}
          onNextBadge={nextCollectionAttendee}
          taskSwitchDisabled={busy || cooldown.saving}
          presentation={presentation}
          onPresentation={togglePresentation}
          canRecordAttendance={!collectorContext && allowedActions.includes("attendance")}
          context={contextLabel}
          lastResult={lastResult}
          connectionStatus={connection}
          operatorControls={
            collectorContext && onSignIn ? <ScannerOfflineSignInButton onSignIn={onSignIn} /> : undefined
          }
          soundLabel={sound.label}
          onTourSound={sound.test}
          onSound={() => sound.toggle(preferences.setSound)}
          result={result}
          status={collectionPrinting.status ?? captureStatus}
          preparation={collectorContext || action === "lead" ? undefined : preparationStatus}
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
          manualLabel={action === "lead" || offline ? "Enter badge code" : undefined}
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
