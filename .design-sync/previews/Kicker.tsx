import { Kicker, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

export function Labels() {
  return (
    <div class="pk pk-cluster">
      <Kicker>Working group</Kicker>
      <Kicker>Charter</Kicker>
      <Kicker>Member organization</Kicker>
      <Kicker>Executive council</Kicker>
      <Kicker>Post-quantum</Kicker>
    </div>
  );
}

export function AboveHeading() {
  return (
    <div class="pk pk-stack pk-stack--tight">
      <Kicker>Working group</Kicker>
      <h2>Post-Quantum Cryptography</h2>
      <p class="pk-lede">
        Vendor-neutral migration guidance for enterprise PKI operators, produced by 38 member organizations.
      </p>
    </div>
  );
}

export function AsParagraph() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Charter revision 3" />
        <PanelBody>
          <div class="pk-stack pk-stack--tight">
            <Kicker as="p">Approved 14 March 2026</Kicker>
            <p class="pk-muted pk-small">
              Rendering the kicker as a paragraph gives it its own block in the flow, which is what a standalone
              eyebrow above body copy needs.
            </p>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
