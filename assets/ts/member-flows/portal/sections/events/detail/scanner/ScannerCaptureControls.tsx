import type { ComponentChildren, ComponentProps } from "preact";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
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
  return (
    <section aria-label="Recovery and diagnostics" class="pk-stack">
      <div class="pk-stack pk-stack--snug">
        <SectionHeading level={3}>Scanner session</SectionHeading>
        <ScannerSessionControls {...session} />
      </div>
      <div class="pk-stack pk-stack--snug">
        <SectionHeading level={3}>Feedback</SectionHeading>
        <ScannerPacing {...pacing} />
        {unverifiedStart && (
          <div class="pk-cluster">
            <Button type="button" variant="secondary" onClick={unverifiedStart}>
              Start with unverified feedback
            </Button>
          </div>
        )}
      </div>
      <div class="pk-stack pk-stack--snug">
        <SectionHeading level={3}>Eligibility data</SectionHeading>
        <ScannerPreparationStatus {...preparation} />
      </div>
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
      <div class="pk-cluster">
        {mode.allowedActions?.includes(mode.action) && (
          <Button type="button" variant="primary" disabled={!canStart} onClick={start}>
            Start scanning
          </Button>
        )}
        {children}
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
}: {
  inline?: boolean;
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
        Manual entry
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
  return offline
    ? "Saved offline · not yet verified"
    : prepared
      ? "Ready to scan"
      : "Unverified scanning. Admission requires verification.";
}
