import type { ComponentChildren, ComponentProps } from "preact";
import type { ContractForm, FieldPresentation } from "../../../../../../hooks/useContractForm";
import type { useScannerManualEntry } from "./useScannerManualEntry";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
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
export function ScannerOfflineSignInButton({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Button type="button" variant="secondary" onClick={onSignIn}>
      Sign in
    </Button>
  );
}

export function ScannerCaptureControls({
  setup,
  mode,
  collector,
  onSignIn,
  canStart,
  preparing,
  cameraError,
  start,
  children,
}: {
  children?: ComponentChildren;
  setup: ComponentProps<typeof ScannerSetup>;
  mode: ComponentProps<typeof ScannerModeSelect>;
  collector?: ScannerOfflineContext;
  onSignIn?: () => void;
  canStart: boolean;
  preparing: boolean;
  cameraError: string;
  start: () => void;
}) {
  return (
    <>
      {collector ? (
        onSignIn && <ScannerOfflineSignInButton onSignIn={onSignIn} />
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
        {entry.lookup?.online === false ? "Enter badge code" : "Find attendee or badge"}
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

export function scannerManualControlProps({
  form,
  action,
  busy,
  ready,
  manual,
  badgeId,
  onBadge,
  onCapture,
  consentConfirmed,
  onConsent,
  slug,
  offline,
}: {
  form: ContractForm<unknown>;
  action: EventScanRequest["action"];
  busy: boolean;
  ready: boolean;
  manual: ReturnType<typeof useScannerManualEntry>;
  badgeId: string;
  onBadge: (code: string) => void;
  onCapture: () => void;
  consentConfirmed: boolean;
  onConsent: (confirmed: boolean) => void;
  slug: string;
  offline: boolean;
}): ComponentProps<typeof ScannerManualControls> {
  return {
    handlers: form.handlers,
    action,
    busy,
    ready,
    open: manual.open,
    onCapture,
    consent:
      action === "lead"
        ? { confirmed: consentConfirmed, field: form.of("consentConfirmed"), onChange: onConsent }
        : undefined,
    onOpen: manual.show,
    onClose: manual.hide,
    entry: {
      focusRequested: manual.focusRequested,
      onFocusHandled: () => manual.setFocusRequested(false),
      badgeId,
      onBadge,
      field: form.of("badgeId"),
      lookup: action !== "lead" ? { slug, online: !offline, disabled: busy || !ready } : undefined,
    },
  };
}

export function scannerStartMessage(prepared: boolean, offline: boolean, action: EventScanRequest["action"]): string {
  if (action === "lead") return "Ready to capture sponsor leads";
  return prepared
    ? "Ready to scan"
    : offline
      ? "Prepared badge data is unavailable. Reconnect to refresh."
      : "Preparing badge checks…";
}
