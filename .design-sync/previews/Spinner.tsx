import { Panel, PanelBody, PanelHeader, Spinner } from "pkic-org-events-backend";

export function Sizes() {
  return (
    <div class="pk pk-stack">
      <Spinner size="sm" label="Checking membership status" />
      <Spinner size="md" label="Verifying the signature on the agreement" />
    </div>
  );
}

export function HiddenLabel() {
  return (
    <div class="pk pk-stack">
      <Spinner label="Loading working groups" />
      <div class="pk-cluster">
        <Spinner size="sm" label="Loading working groups" labelHidden />
        <span class="pk-muted pk-small">
          With <span class="pk-strong">labelHidden</span> the label stays in the DOM for screen readers, so pair the
          spinner with the surrounding copy a sighted reader needs.
        </span>
      </div>
    </div>
  );
}

export function InPanel() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Member organizations" />
        <PanelBody>
          <Spinner label="Loading 284 member organizations…" />
        </PanelBody>
      </Panel>
    </div>
  );
}
