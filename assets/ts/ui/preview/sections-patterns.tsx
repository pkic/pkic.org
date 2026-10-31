import { ServerSelectPreview } from "./ServerSelectPreview";
import { RegistrationFieldsPreview } from "./RegistrationFieldsPreview";
import { VerifiedOrganizationPreview, ProposalIdentityPreview } from "./VerifiedOrganizationPreview";
import { ContentVersionNoticePreview } from "./ContentVersionNoticePreview";
import { ModelNavigationPreview } from "./ModelNavigationPreview";
import { contentContributionPreview } from "./ContentContributionPreview";
import { contentSections } from "./sections-content";
/**
 * Pattern catalog specimens.
 *
 * One section per entry in the `pkic-ui` skill's pattern catalog, rendered
 * with fixture data so an agent can screenshot one control in seconds
 * (`pnpm gallery:shot <id>`) and a reviewer can compare a change against it.
 * A popup's trigger sits inside `data-gallery-open`; use `"focus"` for a
 * focus-open card. The screenshot command opens it before capturing.
 */

import { useState } from "preact/hooks";
import "../Content.css";
import "../../components/member-wall.css";
import "../../components/site-footer.css";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";

import { LIVE_CHAT_REACTIONS } from "../../../shared/live-chat-policy";
import { IconPlus } from "../../components/icons";
import { ReactionPicker } from "../../live-session/ReactionPicker";
import { usePersonCard } from "../../site/PersonCard";
import { AffiliationRow } from "../AffiliationRow";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { DataTable } from "../DataTable";
import { Button } from "../Button";
import { Checkbox, Radio } from "../Checkbox";
import { EmptyState } from "../EmptyState";
import { Field } from "../Field";
import { InputGroup } from "../InputGroup";
import { Menu } from "../Menu";
import { Markdown } from "../Markdown";
import { Meter } from "../Meter";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import { PositionTimeline } from "../PositionTimeline";
import { RowActions } from "../RowActions";
import { SegmentedBar } from "../SegmentedBar";
import { RowList, RowListItem } from "../RowList";
import { TabList } from "../TabList";
import { TextInput } from "../TextControl";
import { Toast } from "../Toast";
import { Toolbar } from "../Toolbar";
import type { ToneProps } from "../tone";
import type { PreviewSection } from "./PreviewShell";
import { ProfileBiographiesExample } from "./profile-biographies";
import { AgendaExample } from "./agenda-example";

/** One membership workflow, as its domain module would declare it: a tone, and a place in the flow while in flight. */
const applicationStages: (ToneProps & { label: string })[] = [
  { label: "Submitted", tone: "neutral" },
  { label: "Staff review", tone: "info", progress: 0.25 },
  { label: "Member consultation", tone: "info", progress: 0.5 },
  { label: "Executive Council review", tone: "info", progress: 0.75 },
  { label: "Board decision", tone: "info", progress: 1 },
  { label: "Waiting on applicant", tone: "warn" },
  { label: "Overdue", tone: "risk" },
  { label: "Approved", tone: "ok" },
  { label: "Rejected", tone: "danger" },
];

const applicationQueue = [
  { name: "Digitorus", stage: 1, submitted: "Oct 2" },
  { name: "Example Trust Services", stage: 3, submitted: "Sep 18" },
  { name: "Northwind CA", stage: 5, submitted: "Sep 30" },
  { name: "Contoso PKI", stage: 6, submitted: "Jul 11" },
  { name: "Litware Trust", stage: 0, submitted: "Oct 14" },
  { name: "Fabrikam Identity", stage: 8, submitted: "Aug 29" },
  { name: "Adatum Security", stage: 7, submitted: "Aug 12" },
];
type QueueRow = (typeof applicationQueue)[number];

function StageBadge({
  stage,
  progressStyle,
}: {
  stage: ToneProps & { label: string };
  progressStyle?: "fade" | "travel";
}) {
  return (
    <Badge tone={stage.tone} progress={stage.progress} progressStyle={progressStyle}>
      {stage.label}
    </Badge>
  );
}

function StageQueue({ caption, toneStyle }: { caption: string; toneStyle?: "edge" | "tint" }) {
  return (
    <DataTable<QueueRow>
      caption={caption}
      columns={[
        { id: "name", header: "Applicant", cell: (row) => row.name },
        { id: "stage", header: "Stage", cell: (row) => <StageBadge stage={applicationStages[row.stage]!} /> },
        { id: "submitted", header: "Submitted", cell: (row) => row.submitted },
      ]}
      rows={applicationQueue}
      rowKey={(row) => row.name}
      rowTone={toneStyle ? (row) => applicationStages[row.stage] : undefined}
      rowToneStyle={toneStyle}
    />
  );
}

const recordActions = [
  { id: "edit", label: "Edit details", onSelect: () => {} },
  { id: "history", label: "View history", onSelect: () => {} },
  { id: "archive", label: "Archive", danger: true, separatorBefore: true, onSelect: () => {} },
];

function PersonCardSpecimen() {
  const preview = usePersonCard<HTMLSpanElement>({
    person: {
      name: "Ana Ferreira",
      affiliation: {
        title: "Security architect",
        organization: { name: "Northwind Review Labs" },
      },
      roles: ["member", "speaker"],
      profilePath: "#person-card",
    },
  });
  return (
    <div class="pk-preview__shelf">
      <span ref={preview.anchorRef} {...preview.hoverProps} data-gallery-open="focus">
        <Button variant="ghost" {...preview.toggleProps}>
          Ana Ferreira
        </Button>
        {preview.card}
      </span>
    </div>
  );
}

function ReactionPickerSpecimen() {
  const [pressed, setPressed] = useState<string[]>(["applause"]);
  return (
    <div class="pk-preview__shelf" data-gallery-open>
      <span>Great point about certificate lifetimes.</span>
      <ReactionPicker
        label="Add a reaction"
        reactions={LIVE_CHAT_REACTIONS}
        pressed={pressed}
        onReact={(id, on) => setPressed((current) => (on ? [...current, id] : current.filter((item) => item !== id)))}
      >
        🙂
      </ReactionPicker>
    </div>
  );
}

function TabsSpecimen() {
  const [active, setActive] = useHashQueryParam<string>("gallerySessionSection", "overview", [
    "overview",
    "speakers",
    "questions",
  ] as const);
  return (
    <TabList
      label="Session sections"
      activeId={active}
      onSelect={setActive}
      items={[
        { id: "overview", label: "Overview" },
        { id: "speakers", label: "Speakers" },
        { id: "questions", label: "Questions", attention: "2 unanswered" },
      ]}
    />
  );
}

function InputGroupSpecimen() {
  const [query, setQuery] = useState("");
  return (
    <div class="pk-preview__shelf pk-preview__shelf--stack">
      <Toolbar
        label="Members"
        search={{
          value: query,
          label: "Search members",
          placeholder: "Name or organization",
          onInput: setQuery,
          onSubmit: () => {},
        }}
      />
      <Field label="Device name (optional)">
        {(control) => (
          <InputGroup>
            <TextInput {...control} placeholder="e.g. Work laptop" />
            <Button variant="primary">Add a passkey</Button>
          </InputGroup>
        )}
      </Field>
      <Field label="Organization" state="invalid" message="Choose an organization.">
        {(control) => (
          <InputGroup>
            <TextInput {...control} placeholder="Organization" />
            <Button variant="secondary" icon aria-label="Add organization" title="Add organization">
              <IconPlus />
            </Button>
          </InputGroup>
        )}
      </Field>
      <Field label="Profile link" labelHidden>
        {(control) => (
          <InputGroup>
            <TextInput {...control} placeholder="https://" />
            <Button icon aria-label="Add profile link" title="Add profile link">
              <IconPlus />
            </Button>
          </InputGroup>
        )}
      </Field>
    </div>
  );
}

function RowListSpecimen() {
  return (
    <Panel>
      <PanelHeader
        title="Email addresses"
        menu={
          <Menu
            label="Email addresses actions"
            items={[{ id: "add", label: "Add email address", onSelect: () => {} }]}
          />
        }
      />
      <PanelBody flush>
        <RowList>
          <RowListItem meta="Primary">admin@example.org</RowListItem>
          <RowListItem
            meta="Not verified yet"
            end={
              <RowActions
                subject="ada@example.net"
                actions={[
                  { id: "resend", label: "Resend verification", onSelect: () => {} },
                  { id: "remove", label: "Remove", onSelect: () => {} },
                ]}
              />
            }
          >
            ada@example.net
          </RowListItem>
        </RowList>
      </PanelBody>
    </Panel>
  );
}

const wallLogo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16" viewBox="0 0 100 40"><path fill="currentColor" d="M0 0h28v40H0zm36 0h28v40H36zm36 0h28v40H72z"/></svg>')}`;

export const patternSections: PreviewSection[] = [
  {
    id: "choice-controls",
    title: "Choice controls",
    render: () => (
      <div class="pk-stack">
        <Radio name="preview-choice" value="selected" label="Selected option" defaultChecked />
        <Radio name="preview-choice" value="available" label="Available option" />
        <Radio name="preview-disabled-choice" label="Unavailable option" disabled />
        <Checkbox label="Selected checkbox" defaultChecked />
        <Checkbox label="Enabled switch" role="switch" defaultChecked />
      </div>
    ),
  },
  {
    id: "framed-image",
    title: "Framed image",
    note: "A framed image fills the available width and retains its original proportions.",
    render: () => (
      <img
        class="pk-framed"
        width={600}
        height={315}
        alt="A circle centered in a landscape image"
        src={`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#f1f5f9"/><circle cx="600" cy="315" r="200" fill="#0c4b38"/></svg>')}`}
      />
    ),
  },
  {
    id: "registration-fields",
    title: "Questionnaire fields",
    note: "Configured dietary and topic controls, shared by public and portal registration.",
    render: () => <RegistrationFieldsPreview />,
  },
  {
    id: "verified-organization",
    title: "Verified organization",
    note: "One chooser for registration, identities, and speaker affiliations.",
    render: () => <VerifiedOrganizationPreview />,
  },
  {
    id: "proposal-identity",
    title: "Proposal identity",
    note: "The actual public proposal identity step embeds the shared verified-domain chooser.",
    render: () => <ProposalIdentityPreview />,
  },
  {
    id: "server-select",
    title: "Server identity picker",
    note: "The current value remains visible, long labels stay inside the field, and choices use the top layer above dialogs.",
    render: () => <ServerSelectPreview />,
  },
  { id: "content-version-notice", title: "Content version notice", render: () => <ContentVersionNoticePreview /> },
  { id: "model-navigation", title: "Model navigation", render: () => <ModelNavigationPreview /> },
  {
    id: "markdown",
    title: "Markdown content",
    render: () => (
      <Markdown
        markdown={
          "A **practical discussion** of migration planning.\n\nThe session covers three things:\n\n- Hardware readiness\n- Migration priorities\n- Investment timing\n\nBring your questions.  \nWe will close with a discussion."
        }
      />
    ),
  },
  {
    id: "profile-biographies",
    title: "General introduction and organization bio",
    note: "About you spans roles. A speaker bio belongs to the selected organization profile; editing one never copies into the other.",
    render: () => <ProfileBiographiesExample />,
  },
  {
    id: "member-wall",
    title: "Member wall",
    render: () => (
      <div class="members-overview">
        <div class="members">
          <div class="logo-wall-copy">
            {Array.from({ length: 18 }, (_, index) => (
              <a href="#member-wall" key={index} aria-label={`Example organization ${index + 1}`}>
                <img src={wallLogo} alt="" class={`member-logo${index % 6 === 0 ? " member-logo-sponsor" : ""}`} />
              </a>
            ))}
          </div>
        </div>
        <div class="members members--zooming">
          <div class="member-zoom-overlay member-zoom-overlay--visible">
            <img src={wallLogo} alt="Example sponsor" class="member-zoom-logo" />
            <div class="member-zoom-info">
              <strong class="member-zoom-name">Example sponsor</strong>
            </div>
            <div class="member-zoom-badge sponsor-tier-6">Diamond sponsor</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "agenda",
    title: "Agenda",
    render: () => <AgendaExample />,
  },
  ...contentSections,
  {
    id: "row-list",
    title: "Row list",
    note: "A few things managed in place: one row each, a quiet line under the name, a hairline between rows and none under the panel header.",
    render: () => <RowListSpecimen />,
  },
  {
    id: "reaction-picker",
    title: "Reaction picker",
    note: "One row of emoji in a popover above the trigger, right edges aligned. Escape, outside click, or a choice closes it.",
    render: () => <ReactionPickerSpecimen />,
  },
  {
    id: "menu",
    title: "Menu",
    note: "Ellipsis trigger; the list opens below, flipping above only without room. At a row or panel end it aligns to the trigger's end.",
    render: () => (
      <div class="pk-preview__shelf" data-gallery-open>
        <Menu label="Actions for Amsterdam 2026" items={recordActions} />
      </div>
    ),
  },
  {
    id: "panel-header",
    title: "Panel header",
    note: "Title left; toolbar right with the ellipsis menu first, then the label-width buttons.",
    render: () => (
      <Panel>
        <PanelHeader
          title="Registration form"
          menu={<Menu label="Registration form actions" align="end" items={recordActions} />}
        >
          <Button>Preview</Button>
          <Button variant="primary">Publish</Button>
        </PanelHeader>
        <PanelBody>Twelve questions, three required.</PanelBody>
      </Panel>
    ),
  },
  {
    id: "tabs",
    title: "Tabs",
    note: "Panels within one view. Arrow keys move and select; the strip scrolls sideways on phones.",
    render: () => <TabsSpecimen />,
  },
  {
    id: "toast",
    title: "Toast",
    note: "Confirms a finished action for five seconds. Never the only place an error is shown.",
    render: () => (
      <div class="pk-preview__shelf pk-preview__shelf--stack">
        <Toast tone="ok" message="Invitation sent to Tomas Riedel" />
        <Toast
          tone="danger"
          message="The badge could not be printed"
          action={{ label: "Try again", onSelect: () => {} }}
        />
      </div>
    ),
  },
  {
    id: "tooltip",
    title: "Tooltip",
    note: "Native title on icon-only controls, paired with the same accessible name. No custom tooltip component.",
    render: () => (
      <div class="pk-preview__shelf">
        <Button icon aria-label="Add a speaker" title="Add a speaker">
          <IconPlus />
        </Button>
      </div>
    ),
  },
  {
    id: "input-group",
    title: "Input group",
    note: "A field and its one action in one row, both one control tall: an inline icon button for search, otherwise an adjacent button inside the field so the label and message stay outside the row.",
    render: () => (
      <div class="pk-stack">
        <InputGroupSpecimen />
        <Field label="Amount">
          {(control) => (
            <InputGroup joined prefix="$">
              <TextInput {...control} inputMode="decimal" placeholder="Amount" />
              <Button variant="primary">Continue</Button>
            </InputGroup>
          )}
        </Field>
      </div>
    ),
  },
  {
    id: "empty-state",
    title: "Empty state",
    note: "Says what is missing and offers the next step only when the surface has no other way to start it.",
    render: () => (
      <EmptyState
        title="No sessions yet"
        body="Accepted proposals appear here once the agenda is published."
        action={{ label: "Add a session", onSelect: () => {} }}
      />
    ),
  },
  {
    id: "people",
    title: "Avatars and badges",
    note: "Initials when there is no photo. Expected states are plain text; a badge marks only the exception.",
    render: () => (
      <div class="pk-preview__shelf">
        <Avatar name="Tomas Riedel" />
        <Avatar name="Ana Lucia Ferreira" size="lg" />
        <Avatar name="Post-Quantum Consortium" shape="square" />
        <span>Registered</span>
        <Badge tone="warn">Waitlisted</Badge>
        <Badge tone="danger">On air</Badge>
      </div>
    ),
  },
  {
    id: "person-card",
    title: "Person hover card",
    note: "Hover, focus, or tap a name to see the person's identity and roles. Escape or a tap elsewhere closes the card.",
    render: () => <PersonCardSpecimen />,
  },
  {
    id: "experience",
    title: "Experience entries",
    note: "The position, where it is held and for how long, then the positions held there on a rail. Ended entries recede.",
    render: () => (
      <Panel>
        <PanelHeader title="Identity and experience" />
        <PanelBody class="pk-stack">
          <AffiliationRow
            media={<Avatar name="Northwind Review Labs" shape="square" size="lg" />}
            title="Solution architect"
            subtitle={
              <ul class="pk-affiliation__terms">
                <li>
                  <a href="#">Northwind Review Labs</a>
                </li>
                <li>Certification Authorities</li>
              </ul>
            }
            terms={["Oct 2026 – Present · 1 mo", "ana@northwind.example"]}
            footer={
              <PositionTimeline
                label="Group roles"
                positions={[
                  {
                    key: "pqc",
                    title: "Chair, Post-Quantum Cryptography Working Group",
                    when: "Jun 2023 – Present · 3 yrs 5 mos",
                    children: (
                      <Meter size="sm" showValue label="11 of 12 meetings attended" value={11} max={12} tone="ok" />
                    ),
                  },
                  {
                    key: "cs",
                    past: true,
                    title: "Code Signing Working Group",
                    when: "Feb 2021 – Mar 2023 · 2 yrs 2 mos",
                    children: (
                      <Meter size="sm" showValue label="9 of 16 meetings attended" value={9} max={16} tone="warn" />
                    ),
                  },
                ]}
              />
            }
            actions={<Menu label="Actions for Northwind Review Labs" align="end" items={recordActions} />}
          >
            Builds certificate validation services for relying parties.
          </AffiliationRow>
          <AffiliationRow
            past
            media={<Avatar name="Contoso Trust" shape="square" size="lg" />}
            title="Compliance lead"
            subtitle="Contoso Trust"
            terms={["Sep 2020 – Mar 2025 · 4 yrs 7 mos"]}
          />
        </PanelBody>
      </Panel>
    ),
  },
  {
    id: "segmented-bar",
    title: "Segmented bar",
    note: "One bar for a whole made of named parts. No legend on the page: pointing at a part names it in the native tooltip.",
    render: () => (
      <div class="pk-preview__shelf pk-preview__shelf--stack">
        <p class="pk-small pk-muted">33 of 49 meetings attended</p>
        <SegmentedBar
          label="33 of 49 meetings attended"
          total={49}
          segments={[
            { key: "pqc", label: "Post-Quantum Cryptography WG: 11 of 12", value: 11 },
            { key: "cs", label: "Code Signing WG: 9 of 16", value: 9 },
            { key: "cl", label: "Certificate Lifecycle WG: 6 of 8", value: 6 },
            { key: "ev", label: "Events Committee: 4 of 4", value: 4 },
            { key: "mp", label: "Mobile PKI WG: 1 of 6", value: 1 },
            { key: "sc", label: "Smart Card WG: 2 of 3", value: 2 },
          ]}
        />
      </div>
    ),
  },
  {
    id: "workflow-stage",
    title: "Workflow stage",
    note: "One color family from the brand rainbow. Tone means the state, never the position: grey not started, blue in flight, yellow waiting on someone, orange at risk, green done well, red rejected. In-flight steps fade the blue in or travel it toward teal. The label is the real stage name. Rows: label only by default, an edge marker for queues, a tint for a short queue where the state is the point.",
    render: () => (
      <div class="pk-preview__shelf pk-preview__shelf--stack">
        <p class="pk-small pk-strong">Fade</p>
        <div class="pk-cluster">
          {applicationStages.map((stage) => (
            <StageBadge key={stage.label} stage={stage} />
          ))}
        </div>
        <p class="pk-small pk-strong">Travel</p>
        <div class="pk-cluster">
          {applicationStages.map((stage) => (
            <StageBadge key={stage.label} stage={stage} progressStyle="travel" />
          ))}
        </div>
        <p class="pk-small pk-strong">Label only</p>
        <StageQueue caption="Applications, label only" />
        <p class="pk-small pk-strong">Edge marker</p>
        <StageQueue caption="Applications with an edge marker" toneStyle="edge" />
        <p class="pk-small pk-strong">Tint</p>
        <StageQueue caption="Applications with a tint" toneStyle="tint" />
      </div>
    ),
  },
  contentContributionPreview,
];
