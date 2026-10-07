import type { ComponentProps } from "preact";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Alert } from "../../../../../../ui/Alert";
import { ScannerSetup } from "./ScannerSetup";
import { ScannerManualEntry } from "./ScannerManualEntry";
import { ScannerModeSelect } from "./ScannerModeSelect";
import { CollapsiblePanel } from "../../../../../../ui/CollapsiblePanel";
import { PanelBody } from "../../../../../../ui/Panel";
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
    <CollapsiblePanel title="Recovery and diagnostics">
      <PanelBody class="pk-stack">
        <ScannerSessionControls {...session} />
        <ScannerPacing {...pacing} />
        <ScannerPreparationStatus {...preparation} />
        {unverifiedStart && (
          <Button type="button" variant="secondary" onClick={unverifiedStart}>
            Start with unverified feedback
          </Button>
        )}
      </PanelBody>
    </CollapsiblePanel>
  );
}

/** Context and mode controls shared by authenticated capture and the fixed offline collector. */
export function ScannerCaptureControls({
  setup,
  mode,
  collector,
  consent,
  consentField,
  onConsent,
  canStart,
  preparing,
  cameraError,
  start,
  onCheckSignIn,
}: {
  setup: ComponentProps<typeof ScannerSetup>;
  mode: ComponentProps<typeof ScannerModeSelect>;
  collector?: ScannerOfflineContext;
  consent: boolean;
  consentField: FieldPresentation;
  onConsent: (checked: boolean) => void;
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
      {!collector && mode.action === "lead" && (
        <Field label="Attendee consent" {...consentField} group>
          {(control) => (
            <Checkbox
              {...control}
              name="consentConfirmed"
              checked={consent}
              onChange={(event) => onConsent(event.currentTarget.checked)}
              label="The attendee agrees to share their contact details with this sponsor."
            />
          )}
        </Field>
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
  entry,
  sync,
}: {
  entry: ComponentProps<typeof ScannerManualEntry>;
  sync?: () => void;
}) {
  return (
    <>
      <ScannerManualEntry {...entry} />
      {sync && (
        <Button type="button" variant="ghost" onClick={sync}>
          Sync now
        </Button>
      )}
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
