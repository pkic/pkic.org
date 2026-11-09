import type { ComponentChildren, ComponentProps } from "preact";
import type { ContractForm, FieldPresentation } from "../../../../../../hooks/useContractForm";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Alert } from "../../../../../../ui/Alert";
import { ScannerSetup } from "./ScannerSetup";
import { ScannerManualEntry } from "./ScannerManualEntry";
import { ScannerModeSelect, scannerActionLabel } from "./ScannerModeSelect";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { Dialog } from "../../../../../../ui/Dialog";
import { ScannerSessionControls } from "./ScannerSessionControls";
import { ScannerPacing } from "./ScannerPacing";
import { ScannerRecovery } from "./ScannerRecovery";

export function ScannerDiagnostics({
  session,
  pacing,
  unverifiedStart,
  sound,
  syncStatus,
}: {
  session: ComponentProps<typeof ScannerSessionControls> & { sessionId?: string };
  pacing: ComponentProps<typeof ScannerPacing>;
  unverifiedStart?: () => void;
  sound?: ComponentChildren;
  syncStatus?: ComponentChildren;
}) {
  const { sessionId, ...sessionControls } = session;
  return (
    <section aria-label="Recovery and diagnostics" class="pk-stack">
      {syncStatus}
      <Panel>
        <PanelHeader title="Feedback" />
        <PanelBody class="pk-stack">
          <p class="pk-muted">These preferences save automatically in this browser.</p>
          <div class="pk-grid pk-grid--cards">
            {sound}
            <ScannerPacing {...pacing} />
          </div>
          {unverifiedStart && (
            <div class="pk-cluster">
              <Button type="button" variant="secondary" onClick={unverifiedStart}>
                Start with unverified feedback
              </Button>
            </div>
          )}
        </PanelBody>
      </Panel>
      <ScannerRecovery
        slug={session.slug}
        operatorUserId={session.operatorUserId}
        sessionId={sessionId}
        sponsorId={session.sponsorId}
        sessionControls={<ScannerSessionControls {...sessionControls} />}
      />
    </section>
  );
}

/** Context and mode controls shared by authenticated capture and the fixed offline collector. */
export function ScannerCaptureControls({
  setup,
  mode,
  collector,
  canStart,
  preparing,
  cameraError,
  start,
  onCheckSignIn,
  children,
}: {
  children?: ComponentChildren;
  setup: ComponentProps<typeof ScannerSetup>;
  mode: ComponentProps<typeof ScannerModeSelect>;
  collector?: ScannerOfflineContext;
  canStart: boolean;
  preparing: boolean;
  cameraError: string;
  start: () => void;
  onCheckSignIn?: () => void;
}) {
  return (
    <>
      {collector ? (
        <Alert tone="info" title="Offline scanning">
          <div class="pk-stack pk-stack--snug">
            <p>Badge checks use prepared data. Scans save on this device and upload when connected.</p>
            {onCheckSignIn && (
              <div class="pk-cluster">
                <Button type="button" variant="secondary" onClick={onCheckSignIn}>
                  Check sign-in again
                </Button>
              </div>
            )}
          </div>
        </Alert>
      ) : (
        <>
          <ScannerSetup {...setup} allowedActions={mode.allowedActions} onAction={mode.onAction} onStart={start} />
        </>
      )}
      <div class="pk-cluster">
        {(collector || mode.action === "lead") && mode.allowedActions?.includes(mode.action) && (
          <Button type="button" variant="primary" disabled={!canStart} onClick={start}>
            Start scanning
          </Button>
        )}
        {(collector || mode.action === "lead") && children}
      </div>
      {preparing && <p role="status">Preparing scanner for this session…</p>}
      {cameraError && <p role="status">{cameraError}</p>}
    </>
  );
}

export function ScannerManualControls({
  action,
  busy,
  ready,
  onCapture,
  entry,
  open,
  onOpen,
  onClose,
  consent,
  inline = false,
  handlers,
}: {
  inline?: boolean;
  handlers?: ContractForm<unknown>["handlers"];
  action: EventScanRequest["action"];
  busy: boolean;
  ready: boolean;
  onCapture: () => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  entry: ComponentProps<typeof ScannerManualEntry>;
  consent?: { confirmed: boolean; field: FieldPresentation; onChange: (confirmed: boolean) => void };
}) {
  const content = (
    <ScannerManualEntry {...entry}>
      {action === "lead" && consent && (
        <Field label="Attendee consent" {...consent.field} required group>
          {(control) => (
            <Checkbox
              {...control}
              name="consentConfirmed"
              checked={consent.confirmed}
              onChange={(event) => consent.onChange(event.currentTarget.checked)}
              label="The attendee agrees to share their contact details with this sponsor."
            />
          )}
        </Field>
      )}
    </ScannerManualEntry>
  );
  if (inline)
    return (
      <form
        class="pk-stack"
        noValidate
        {...handlers}
        onSubmit={(event) => {
          event.preventDefault();
          onCapture();
        }}
      >
        {content}
        <div class="pk-cluster">
          <Button type="submit" disabled={busy || !ready}>
            {action === "lead" ? "Confirm lead" : scannerActionLabel(action)}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Return to scanning
          </Button>
        </div>
      </form>
    );
  return (
    <>
      <Button type="button" variant="secondary" onClick={onOpen}>
        Find attendee or badge
      </Button>
      <Dialog
        open={open}
        title={action === "lead" ? "Review sponsor lead" : "Enter badge code"}
        confirmLabel={action === "lead" ? "Confirm lead" : scannerActionLabel(action)}
        confirmDisabled={busy || !ready}
        onConfirm={onCapture}
        onCancel={onClose}
      >
        {open && content}
      </Dialog>
    </>
  );
}

export function scannerStartMessage(prepared: boolean, offline: boolean, action: EventScanRequest["action"]): string {
  if (action === "lead") return "Ready to capture sponsor leads";
  return prepared
    ? "Ready to scan"
    : offline
      ? "Prepared badge data is unavailable. Reconnect to refresh."
      : "Preparing badge checks…";
}
