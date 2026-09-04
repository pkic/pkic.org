import { Badge, Button, ButtonLink, DescriptionList, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

export function GroupRecord() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Post-Quantum Cryptography">
          <Badge tone="ok">Chartered</Badge>
          <ButtonLink href="#charter" variant="secondary" size="sm">
            View charter
          </ButtonLink>
        </PanelHeader>
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Chair", value: "Alice Chen, SecureCA Inc" },
              { term: "Chartered", value: "14 March 2024" },
              { term: "Participating organizations", value: "38" },
              { term: "Meeting cadence", value: "Every second Tuesday, 15:00 UTC" },
              { term: "Deliverable", value: "Migration guidance for enterprise PKI operators" },
            ]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

export function BodyWithoutHeader() {
  return (
    <div class="pk">
      <Panel>
        <PanelBody>
          <p class="pk-lede">
            Working group participation is open to every member organization in good standing.
          </p>
          <p class="pk-muted pk-small">
            Nominate a representative through your organization&rsquo;s primary contact. Nominations are confirmed by
            the group chair at the next scheduled meeting.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

export function StackedPanels() {
  return (
    <div class="pk pk-stack">
      <Panel>
        <PanelHeader title="Membership agreement">
          <Badge tone="warn">Renewal due</Badge>
        </PanelHeader>
        <PanelBody>
          <DescriptionList
            density="compact"
            items={[
              { term: "Organization", value: "Nordic Trust Services AS" },
              { term: "Signed", value: "2023-11-02" },
              { term: "Expires", value: "2026-11-01" },
            ]}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Group memberships">
          <Button variant="secondary" size="sm">
            Add group
          </Button>
        </PanelHeader>
        <PanelBody>
          <DescriptionList
            density="compact"
            items={[
              { term: "Post-Quantum Cryptography", value: "Contributor since 2024" },
              { term: "Certificate Lifecycle Management", value: "Chair since 2025" },
              { term: "PKI Maturity Model", value: "Observer" },
            ]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
