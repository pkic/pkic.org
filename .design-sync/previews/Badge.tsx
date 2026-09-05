import { Badge, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

export function Tones() {
  return (
    <div class="pk pk-cluster">
      <Badge tone="ok">Chartered</Badge>
      <Badge tone="warn">Renewal due</Badge>
      <Badge tone="danger">Agreement lapsed</Badge>
      <Badge tone="info">Draft charter</Badge>
      <Badge tone="neutral">Observer</Badge>
      <Badge tone="accent">Featured group</Badge>
    </div>
  );
}

export function WithoutDot() {
  return (
    <div class="pk pk-cluster">
      <Badge tone="ok" dot={false}>
        Chartered
      </Badge>
      <Badge tone="warn" dot={false}>
        Renewal due
      </Badge>
      <Badge tone="danger" dot={false}>
        Agreement lapsed
      </Badge>
      <Badge tone="info" dot={false}>
        Draft charter
      </Badge>
      <Badge tone="neutral" dot={false}>
        Observer
      </Badge>
      <Badge tone="accent" dot={false}>
        Featured group
      </Badge>
    </div>
  );
}

export function InRecordRows() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Working groups" />
        <PanelBody>
          <div class="pk-stack pk-stack--tight">
            <div class="pk-cluster pk-cluster--between">
              <span>Post-Quantum Cryptography</span>
              <Badge tone="ok">Chartered</Badge>
            </div>
            <div class="pk-cluster pk-cluster--between">
              <span>Certificate Lifecycle Management</span>
              <Badge tone="info">Draft charter</Badge>
            </div>
            <div class="pk-cluster pk-cluster--between">
              <span>PKI Maturity Model</span>
              <Badge tone="warn">Chair vacant</Badge>
            </div>
            <div class="pk-cluster pk-cluster--between">
              <span>Code Signing</span>
              <Badge tone="neutral">Dormant</Badge>
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
