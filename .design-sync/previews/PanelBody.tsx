import {
  Button,
  DescriptionList,
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
  PersonCell,
} from "pkic-org-events-backend";

export function ProseBody() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Scope of work" />
        <PanelBody>
          <p class="pk-lede">
            The group produces vendor-neutral guidance for migrating enterprise PKI to post-quantum algorithms.
          </p>
          <p class="pk-muted pk-small">
            Deliverables are published under the consortium&rsquo;s open license once approved by the executive
            council. Drafts remain visible to participating organizations only.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

export function RosterBody() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Group participants">
          <Button variant="secondary" size="sm">
            Invite
          </Button>
        </PanelHeader>
        <PanelBody>
          <div class="pk-stack pk-stack--tight">
            <PersonCell name="Alice Chen" email="a.chen@secureca.example" />
            <PersonCell name="Bo Halvorsen" email="bo.halvorsen@nordictrust.example" />
            <PersonCell name="Priya Raman" email="p.raman@certauthority.example" />
            <PersonCell name="Marc Dubois" email="m.dubois@eurotrust.example" />
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

export function BodyDensities() {
  return (
    <div class="pk pk-stack">
      <Panel>
        <PanelHeader title="Agreement details" />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Legal name", value: "Nordic Trust Services AS" },
              { term: "Membership tier", value: "Full member" },
              { term: "Primary contact", value: "Bo Halvorsen" },
            ]}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Pending nominations" />
        <PanelBody>
          <EmptyState
            title="No nominations awaiting review"
            body="New participant nominations from member organizations will appear here."
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
