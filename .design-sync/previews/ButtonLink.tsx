import { Button, ButtonLink, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

export function Variants() {
  return (
    <div class="pk pk-cluster">
      <ButtonLink href="#charter" variant="primary">
        Read the charter
      </ButtonLink>
      <ButtonLink href="#groups" variant="secondary">
        Browse working groups
      </ButtonLink>
      <ButtonLink href="#minutes" variant="ghost">
        Meeting minutes
      </ButtonLink>
      <ButtonLink href="#withdraw" variant="danger">
        Withdraw membership
      </ButtonLink>
      <ButtonLink href="#leave" variant="danger-quiet">
        Leave group
      </ButtonLink>
      <ButtonLink href="#history" variant="link">
        View revision history
      </ButtonLink>
    </div>
  );
}

export function Sizes() {
  return (
    <div class="pk pk-cluster pk-cluster--center">
      <ButtonLink href="#join" size="sm">
        Join group
      </ButtonLink>
      <ButtonLink href="#join" size="md">
        Join group
      </ButtonLink>
      <ButtonLink href="#join" size="lg">
        Join group
      </ButtonLink>
    </div>
  );
}

export function BlockAndIcon() {
  return (
    <div class="pk pk-stack">
      <ButtonLink href="#apply" variant="primary" block>
        Apply for membership
      </ButtonLink>
      <div class="pk-cluster">
        <ButtonLink href="#download" icon aria-label="Download the signed agreement">
          ↓
        </ButtonLink>
        <span class="pk-muted pk-small">Download the signed agreement</span>
      </div>
    </div>
  );
}

export function AlongsideButton() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Certificate Lifecycle Management">
          <ButtonLink href="#charter" variant="secondary" size="sm">
            View charter
          </ButtonLink>
          <Button variant="primary" size="sm">
            Join group
          </Button>
        </PanelHeader>
        <PanelBody>
          <p class="pk-muted pk-small">
            A link drawn as a button lines up with a real button, so a destination and an action can share one toolbar.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
