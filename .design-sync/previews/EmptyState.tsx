import { Button, ButtonLink, EmptyState, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

export function WithAction() {
  return (
    <div class="pk">
      <EmptyState
        title="No participants yet"
        body="Invite representatives from member organizations to join the Post-Quantum Cryptography working group."
      >
        <Button variant="primary">Invite participant</Button>
      </EmptyState>
    </div>
  );
}

export function TitleAndBodyOnly() {
  return (
    <div class="pk pk-stack pk-stack--loose">
      <EmptyState
        title="No meetings scheduled"
        body="The group meets every second Tuesday. The next agenda is published one week in advance."
      />
      <EmptyState title="No certificates match this filter" />
    </div>
  );
}

export function InsidePanel() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Charter revisions">
          <Button variant="secondary" size="sm">
            Upload draft
          </Button>
        </PanelHeader>
        <PanelBody>
          <EmptyState
            title="This group has no charter on file"
            body="A chartered group needs an approved scope statement before it can publish deliverables."
          >
            <ButtonLink href="#draft" variant="primary">
              Start a charter
            </ButtonLink>
          </EmptyState>
        </PanelBody>
      </Panel>
    </div>
  );
}
