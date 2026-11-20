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
  title = "Start scanning",
  connection,
  context,
  feedback,
  form,
  busy,
  capture,
  controls,
  pendingStart,
  devicePreparation,
  cancelStart,
  retryStart,
  children,
}: {
  title?: string;
  connection: ComponentChildren;
  context?: ComponentProps<typeof ScannerCaptureContext>;
  feedback?: ComponentProps<typeof ScannerFeedback>;
  form: Pick<import("../../../../../../hooks/useContractForm").ContractForm<unknown>, "handlers">;
  busy: boolean;
  capture: () => void;
  controls: ComponentChildren;
  pendingStart?: ScannerReadiness;
  devicePreparation?: { ready: boolean; error: string };
  cancelStart: () => void;
  retryStart: () => void;
  children?: ComponentChildren;
}) {
  const status =
    pendingStart && devicePreparation
      ? {
          ...pendingStart,
          ready: pendingStart.ready && devicePreparation.ready,
          preparing:
            pendingStart.preparing || (!devicePreparation.ready && !devicePreparation.error && !pendingStart.error),
          error: devicePreparation.error || pendingStart.error,
        }
      : pendingStart;
  return (
    <Panel>
      <PanelHeader title={title} />
      <PanelBody>
        {connection}
        {devicePreparation?.error && !pendingStart && (
          <Button type="button" variant="secondary" onClick={retryStart}>
            Retry scanner preparation
          </Button>
        )}
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
        title={status?.badgeCollection ? "Prepare badge collection" : "Prepare scanner"}
        confirmLabel="Retry preparation"
        onConfirm={retryStart}
        onCancel={cancelStart}
        viewer
        footerActions={
          <>
            <Button type="button" variant="ghost" onClick={cancelStart}>
              Cancel
            </Button>
            {status?.error && !status.preparing && (
              <Button type="button" onClick={retryStart}>
                Retry preparation
              </Button>
            )}
          </>
        }
      >
        {status?.error && !status.preparing ? (
          <Alert tone="warn">{status.error}</Alert>
        ) : (
          <p role="status">{status ? scannerReadinessLabel(status) : ""}</p>
        )}
      </Dialog>
    </Panel>
  );
}
