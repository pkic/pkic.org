import type { ComponentChildren, ComponentProps } from "preact";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Button } from "../../../../../../ui/Button";
import { ScannerCaptureContext } from "./ScannerCaptureContext";
import { ScannerFeedback } from "./ScannerFeedback";

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
  children,
}: {
  connection: ComponentChildren;
  context?: ComponentProps<typeof ScannerCaptureContext>;
  feedback?: ComponentProps<typeof ScannerFeedback>;
  form: Pick<import("../../../../../../hooks/useContractForm").ContractForm<unknown>, "handlers">;
  busy: boolean;
  capture: () => void;
  controls: ComponentChildren;
  pendingStart?: string;
  cancelStart: () => void;
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
        {pendingStart && (
          <div role="status">
            <p>{pendingStart}</p>
            <Button type="button" variant="secondary" onClick={cancelStart}>
              Cancel
            </Button>
          </div>
        )}
        <p class="pk-muted pk-small">Scans save on this device and upload automatically.</p>
        {children}
      </PanelBody>
    </Panel>
  );
}
