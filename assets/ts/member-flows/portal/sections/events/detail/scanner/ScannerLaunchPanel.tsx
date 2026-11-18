import type { ComponentChildren, ComponentProps } from "preact";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { Alert } from "../../../../../../ui/Alert";
import { ScannerCaptureContext } from "./ScannerCaptureContext";
import { ScannerFeedback } from "./ScannerFeedback";
import { scannerReadinessLabel, type ScannerReadiness } from "./ScannerConnectionStatus";

/** The launch screen owns presentation; capture and uploads remain in the scanner controller. */
export function ScannerLaunchPanel({
  connection,
  context,
  feedback,
  form,
  busy,
  capture,
  controls,
  pendingStart,
  cancelStart,
  retryStart,
  children,
}: {
  connection: ComponentChildren;
  context?: ComponentProps<typeof ScannerCaptureContext>;
  feedback?: ComponentProps<typeof ScannerFeedback>;
  form: Pick<import("../../../../../../hooks/useContractForm").ContractForm<unknown>, "handlers">;
  busy: boolean;
  capture: () => void;
  controls: ComponentChildren;
  pendingStart?: ScannerReadiness;
  cancelStart: () => void;
  retryStart: () => void;
  children?: ComponentChildren;
}) {
  return (
    <Panel>
      <PanelHeader title="Start scanning" />
      <PanelBody>
        {connection}
        {context && <ScannerCaptureContext {...context} />}
        {feedback && <ScannerFeedback {...feedback} compact />}
        <form
          class="pk-form"
          noValidate
          aria-busy={busy}
          {...form.handlers}
          onSubmit={(event) => {
            event.preventDefault();
            capture();
          }}
        >
          {controls}
        </form>
        {children}
      </PanelBody>
      <Dialog
        open={Boolean(pendingStart)}
        title={pendingStart?.badgeCollection ? "Prepare badge collection" : "Prepare scanner"}
        confirmLabel="Retry preparation"
        onConfirm={retryStart}
        onCancel={cancelStart}
        viewer
        footerActions={
          <>
            <Button type="button" variant="ghost" onClick={cancelStart}>
              Cancel
            </Button>
            {pendingStart?.error && !pendingStart.preparing && (
              <Button type="button" onClick={retryStart}>
                Retry preparation
              </Button>
            )}
          </>
        }
      >
        {pendingStart?.error && !pendingStart.preparing ? (
          <Alert tone="warn">{pendingStart.error}</Alert>
        ) : (
          <p role="status">{pendingStart ? scannerReadinessLabel(pendingStart) : ""}</p>
        )}
      </Dialog>
    </Panel>
  );
}
