import { Badge, Button, ButtonLink, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

export function TitleOnly() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Charter history" />
        <PanelBody>
          <p class="pk-muted pk-small">
            Three revisions since the group was chartered in March 2024.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

export function WithToolbar() {
  return (
    <div class="pk pk-stack">
      <Panel>
        <PanelHeader title="Certificate Lifecycle Management">
          <Badge tone="info">Draft charter</Badge>
          <Button variant="secondary" size="sm">
            Edit
          </Button>
          <ButtonLink href="#publish" variant="primary" size="sm">
            Publish
          </ButtonLink>
        </PanelHeader>
        <PanelBody>
          <p class="pk-muted pk-small">
            The toolbar slot holds the actions that belong to this panel, right-aligned against the title.
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Member organizations">
          <Button variant="secondary" size="sm">
            Export CSV
          </Button>
        </PanelHeader>
        <PanelBody>
          <p class="pk-muted pk-small">284 organizations across 41 jurisdictions.</p>
        </PanelBody>
      </Panel>
    </div>
  );
}

export function HeadingLevels() {
  return (
    <div class="pk pk-stack">
      <Panel>
        <PanelHeader title="Working groups (heading level 2)" headingLevel={2} />
        <PanelBody>
          <p class="pk-muted pk-small">Use level 2 when the panel is the page&rsquo;s top-level section.</p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Post-Quantum Cryptography (level 3, the default)" />
        <PanelBody>
          <p class="pk-muted pk-small">Level 3 is the default so panels nest without breaking the outline.</p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Meeting minutes (heading level 4)" headingLevel={4} />
        <PanelBody>
          <p class="pk-muted pk-small">Level 4 for a panel inside an already-nested region.</p>
        </PanelBody>
      </Panel>
    </div>
  );
}
