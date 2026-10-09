import type { ComponentProps } from "preact";
import { useState } from "preact/hooks";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Alert } from "../../../../../../ui/Alert";
import { ScannerSetup } from "./ScannerSetup";
import { ScannerManualEntry } from "./ScannerManualEntry";
import { ScannerModeSelect, scannerActionLabel } from "./ScannerModeSelect";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { Dialog } from "../../../../../../ui/Dialog";
import { ScannerSessionControls } from "./ScannerSessionControls";
import { ScannerPacing } from "./ScannerPacing";
import { ScannerPreparationStatus } from "./ScannerPreparationStatus";

export function ScannerDiagnostics({
  session,
  pacing,
  preparation,
  unverifiedStart,
}: {
  session: ComponentProps<typeof ScannerSessionControls>;
  pacing: ComponentProps<typeof ScannerPacing>;
  preparation: ComponentProps<typeof ScannerPreparationStatus>;
  unverifiedStart?: () => void;
}) {
  const [open, setOpen] = useState(false);
  function close() {
    setOpen(false);
    session.capturePause(false);
  }
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          session.capturePause(true);
          setOpen(true);
        }}
      >
        Recovery and diagnostics
      </Button>
      <Dialog open={open} title="Recovery and diagnostics" confirmLabel="Done" onConfirm={close} onCancel={close}>
        {open && (
          <div class="pk-stack">
            <ScannerSessionControls {...session} />
            <ScannerPacing {...pacing} />
            <ScannerPreparationStatus {...preparation} />
            {unverifiedStart && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  close();
                  unverifiedStart();
                }}
              >
                Start with unverified feedback
              </Button>
            )}
          </div>
        )}
      </Dialog>
    </>
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
}: {
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
        <Alert tone="warn" title="Offline · unverified until synced">
          <div class="pk-stack pk-stack--snug">
            <p>Scans are saved on this device and checked when you reconnect.</p>
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
          <ScannerSetup {...setup} />
          <ScannerModeSelect {...mode} />
        </>
      )}
      {mode.allowedActions?.includes(mode.action) && (
        <Button type="button" variant="primary" disabled={!canStart} onClick={start}>
          Start scanning
        </Button>
      )}
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
}: {
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
  return (
    <>
      <Button type="button" variant="secondary" onClick={onOpen}>
        Enter code
      </Button>
      <Dialog
        open={open}
        title={action === "lead" ? "Review sponsor lead" : "Enter badge code"}
        confirmLabel={action === "lead" ? "Confirm lead" : scannerActionLabel(action)}
        confirmDisabled={busy || !ready}
        onConfirm={onCapture}
        onCancel={onClose}
      >
        {open && (
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
        )}
      </Dialog>
    </>
  );
}

export function scannerStartMessage(prepared: boolean, offline: boolean): string {
  return offline
    ? "Saved offline · not yet verified"
    : prepared
      ? "Ready to scan"
      : "Unverified scanning. Admission requires verification.";
}
