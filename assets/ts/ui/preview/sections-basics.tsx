import type { PreviewSection } from "./PreviewShell";
import { Alert } from "../Alert";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Chip } from "../Chip";
import { EmptyState } from "../EmptyState";
import { Kicker } from "../Kicker";
import { PersonCell } from "../PersonCell";
import { Spinner } from "../Spinner";
import { StatCard } from "../StatCard";

export const basicSections: PreviewSection[] = [
  {
    id: "actions",
    title: "Actions",
    note: "Every button variant and size, with state combinations.",
    render: () => (
      <>
        <div class="pk-preview__shelf">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="danger-quiet">Danger Quiet</Button>
          <Button variant="link">Link</Button>
        </div>

        <div class="pk-preview__shelf">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>

        <div class="pk-preview__shelf">
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
          <Button icon aria-label="Settings">
            ⚙️
          </Button>
          <Button block>Block width</Button>
        </div>
      </>
    ),
  },

  {
    id: "status",
    title: "Status",
    note: "Status indicators, labels, and filter chips.",
    render: () => (
      <>
        <div class="pk-preview__shelf">
          <Badge tone="ok" dot>
            Approved
          </Badge>
          <Badge tone="ok">No dot</Badge>
          <Badge tone="warn" dot>
            Pending
          </Badge>
          <Badge tone="danger" dot>
            Rejected
          </Badge>
          <Badge tone="info" dot>
            New
          </Badge>
          <Badge tone="neutral" dot>
            Neutral
          </Badge>
          <Badge tone="accent" dot>
            Featured
          </Badge>
        </div>

        <div class="pk-preview__shelf">
          <Kicker>Working Group</Kicker>
          <Kicker>Post-Quantum</Kicker>
        </div>

        <div class="pk-preview__shelf">
          <Chip pressed>Cryptography</Chip>
          <Chip>Compliance</Chip>
          <Chip onRemove={() => {}}>Removable</Chip>
        </div>
      </>
    ),
  },

  {
    id: "feedback",
    title: "Feedback",
    note: "Messages, loading states, and empty screens.",
    render: () => (
      <>
        <div class="pk-preview__shelf--stack">
          <Alert tone="ok" title="Success">
            Profile updated successfully.
          </Alert>
          <Alert tone="info" title="Information">
            Two-factor authentication is enabled.
          </Alert>
          <Alert tone="warn" title="Warning">
            Your certificate expires in 30 days.
          </Alert>
          <Alert tone="danger" title="Error">
            Access denied. Contact your administrator.
          </Alert>
        </div>

        <div class="pk-preview__shelf">
          <Spinner label="Verifying signature" />
          <Spinner label="Loading…" labelHidden />
        </div>

        <div class="pk-preview__shelf--stack">
          <EmptyState title="No members" body="Invite members to your working group to get started.">
            <Button variant="primary">Invite Member</Button>
          </EmptyState>
        </div>
      </>
    ),
  },

  {
    id: "identity",
    title: "People",
    note: "Avatars, member cells, and statistics.",
    render: () => (
      <>
        <div class="pk-preview__shelf">
          <Avatar name="Alice Chen" />
          <Avatar name="Bob Martinez" size="sm" />
          <Avatar name="Carol Davis" size="lg" />
          <Avatar
            name="David Rodriguez"
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect fill='%2348bb78' width='32' height='32'/%3E%3C/svg%3E"
          />
        </div>

        <div class="pk-preview__shelf--stack">
          <PersonCell
            name="Alice Chen"
            email="achen@example.com"
            avatarSrc="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect fill='%239f7aea' width='32' height='32'/%3E%3C/svg%3E"
          />
          <PersonCell name="Bob Martinez" size="sm" />
        </div>

        <div class="pk-preview__grid">
          <StatCard label="Members" value="147" trend="up" note="12 this quarter" />
          <StatCard label="Certifications" value="8,204" trend="down" note="2% from last quarter" />
          <StatCard label="Audits" value="42" note="36 compliant" />
          <StatCard label="Pending Review" value="3" />
        </div>
      </>
    ),
  },
];
