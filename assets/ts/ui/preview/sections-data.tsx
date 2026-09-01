import { useState } from "preact/hooks";
import type { PreviewSection } from "./PreviewShell";
import { Badge } from "../Badge";
import { Breadcrumb } from "../Breadcrumb";
import { Button } from "../Button";
import { DataTable } from "../DataTable";
import { DescriptionList } from "../DescriptionList";
import { Field } from "../Field";
import { FileInput } from "../FileInput";
import { Menu, type MenuItem } from "../Menu";
import { Meter } from "../Meter";
import { Pager } from "../Pager";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import { PersonCell } from "../PersonCell";
import { RowActions } from "../RowActions";
import { PageHeader } from "../PageHeader";
import { Select, Textarea, TextInput } from "../TextControl";
import { Tabs } from "../Tabs";
import { Toast } from "../Toast";

/** Stands in for an uploaded logo, so the preview page fetches nothing. */
const LOGO_SPECIMEN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'%3E%3Crect fill='%234c51bf' width='120' height='40' rx='6'/%3E%3Ctext x='60' y='25' fill='%23ffffff' font-family='sans-serif' font-size='14' text-anchor='middle'%3ESecureCA%3C/text%3E%3C/svg%3E";

interface Member {
  id: string;
  name: string;
  email: string;
  organization: string;
  joined: string;
}

const MEMBERS: Member[] = [
  {
    id: "m1",
    name: "Alice Chen",
    email: "achen@example.com",
    organization: "SecureCA Inc",
    joined: "2025-01-15",
  },
  {
    id: "m2",
    name: "Bob Martinez",
    email: "bmartinez@example.com",
    organization: "CryptoKey Labs",
    joined: "2025-02-20",
  },
  {
    id: "m3",
    name: "Carol Davis",
    email: "cdavis@example.com",
    organization: "Trust Systems",
    joined: "2025-03-10",
  },
  {
    id: "m4",
    name: "David Rodriguez",
    email: "drodriguez@example.com",
    organization: "CertNet Global",
    joined: "2025-03-25",
  },
];

export const dataSections: PreviewSection[] = [
  {
    id: "forms",
    title: "Forms",
    note: "Form controls with labels, validation states, and help text.",
    render: () => (
      <div class="pk-preview__shelf--stack">
        <div class="pk-preview__narrow">
          <Field label="Email address" help="We'll never share your email.">
            {(props) => <TextInput {...props} type="email" placeholder="alice@example.com" />}
          </Field>

          <Field label="Organization" required state="ok" message="Organization verified.">
            {(props) => <TextInput {...props} placeholder="Your organization" />}
          </Field>

          <Field label="Role" state="advisory" message="Personal email domains may not be suitable for production.">
            {(props) => (
              <Select {...props}>
                <option value="">Select a role</option>
                <option value="member">Member</option>
                <option value="lead">Working Group Lead</option>
                <option value="admin">Administrator</option>
              </Select>
            )}
          </Field>

          <Field label="Biography" required state="invalid" message="Biography must be at least 10 characters.">
            {(props) => <Textarea {...props} placeholder="Tell us about your expertise…" />}
          </Field>

          <Field label="Supporting document" help="PDF, up to 5 MB.">
            {(props) => <FileInput {...props} accept="application/pdf" />}
          </Field>

          {/* The preview slot: a field that already has a value shows it
              inside the control rather than beside it. */}
          <Field label="Organization logo" help="SVG or PNG. Replaces the current logo once approved.">
            {(props) => (
              <FileInput
                {...props}
                accept="image/svg+xml,image/png"
                buttonLabel="Replace logo"
                preview={<img src={LOGO_SPECIMEN} alt="Current logo" />}
              />
            )}
          </Field>

          <Field label="Charter" state="invalid" message="Choose a file to upload.">
            {(props) => <FileInput {...props} />}
          </Field>

          <Field label="Signed agreement" help="Locked until the application is approved.">
            {(props) => <FileInput {...props} disabled />}
          </Field>
        </div>
      </div>
    ),
  },

  {
    id: "details",
    title: "Detail lists",
    note: "Term and value pairs for a record: two densities, wrapping values, and an em dash where a value is missing.",
    render: () => (
      <div class="pk-preview__shelf--stack">
        <Panel>
          <PanelHeader title="Profile" />
          <PanelBody>
            <DescriptionList
              items={[
                { term: "Legal name", value: "SecureCA Inc" },
                { term: "Membership", value: "Full member since 2021" },
                {
                  term: "Certification practice statement",
                  value: (
                    <a href="#cps">https://policy.example.test/repository/certification-practice-statement/current</a>
                  ),
                },
                { term: "Slogan" },
                { term: "Headquarters", value: "Trondheim, Norway" },
              ]}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Submission (compact)" />
          <PanelBody>
            <DescriptionList
              density="compact"
              items={[
                { term: "Submitted", value: "2026-08-14" },
                { term: "Reviewer", value: "Alice Chen" },
                { term: "Decision" },
                { term: "Notes", value: "Awaiting confirmation from the applicant's sponsoring organization." },
              ]}
            />
          </PanelBody>
        </Panel>
      </div>
    ),
  },

  {
    id: "data",
    title: "Tables",
    note: "Data tables with sorting, selection, and bulk actions.",
    render: () => {
      const [sort, setSort] = useState<{ columnId: string; direction: "asc" | "desc" } | undefined>({
        columnId: "name",
        direction: "asc",
      });
      const [selection, setSelection] = useState(new Set<string>());

      const memberItems: MenuItem[] = [
        { id: "edit", label: "Edit", onSelect: () => {} },
        { id: "email", label: "Send message", onSelect: () => {} },
        { id: "remove", label: "Remove", danger: true, onSelect: () => {} },
      ];

      return (
        <>
          <DataTable<Member>
            caption="Working group members"
            columns={[
              {
                id: "name",
                header: "Name",
                cell: (row) => row.name,
                sortable: true,
              },
              {
                id: "email",
                header: "Email",
                cell: (row) => row.email,
              },
              {
                id: "organization",
                header: "Organization",
                cell: (row) => row.organization,
              },
              {
                id: "joined",
                header: "Joined",
                cell: (row) => row.joined,
                sortable: true,
              },
              {
                id: "actions",
                header: "Actions",
                cell: (row) => <Menu label={`Actions for ${row.name}`} items={memberItems} />,
                headerHidden: true,
              },
            ]}
            rows={MEMBERS}
            rowKey={(row) => row.id}
            sort={sort}
            onSort={(columnId, direction) => setSort({ columnId, direction })}
            selection={{
              selected: selection,
              onChange: (next) => {
                setSelection(new Set(next));
              },
              rowLabel: (key) => {
                const member = MEMBERS.find((m) => m.id === key);
                return `Select ${member?.name ?? key}`;
              },
            }}
          />

          {/*
           * A roster, in the shape the portal's lists actually take: a face and
           * a second line, a phrase, a date, and something the row can do.
           *
           * It is here because the specimens above are four columns of short
           * even strings, which is the one shape whose columns never drift —
           * and so the portal's tables drifted for a year without this page
           * showing it. `pk-table-list` is what a real list is drawn in, so
           * the measure the portal gets is the measure on this page too.
           */}
          <div class="pk-stack pk-stack--snug pk-table-list">
            <DataTable<Member>
              caption="Members and what can be done to them"
              columns={[
                {
                  id: "person",
                  header: "Person",
                  sortable: true,
                  cell: (row) => <PersonCell name={row.name} email={row.email} size="sm" />,
                },
                { id: "organization", header: "Capacity", cell: (row) => row.organization },
                // A date has a bounded length: it hugs, so the columns that
                // hold prose keep the width instead.
                { id: "joined", header: "Joined", cell: (row) => row.joined, sortable: true, width: "fit" },
                {
                  id: "actions",
                  header: "Actions",
                  headerHidden: true,
                  align: "end",
                  cell: (row) => (
                    <RowActions
                      subject={row.name}
                      status={row.id === "m1" ? "Chair" : undefined}
                      actions={
                        row.id === "m2"
                          ? memberItems
                          : [{ id: "remove", label: "Remove from group", onSelect: () => {} }]
                      }
                    />
                  ),
                },
              ]}
              rows={MEMBERS}
              rowKey={(row) => row.id}
              rowAction={(row) => ({ label: `Open ${row.name}`, href: `#${row.id}` })}
            />
            <Pager
              label="Roster pagination"
              page={1}
              pageCount={4}
              total={14}
              rangeStart={1}
              rangeEnd={4}
              onSelect={() => {}}
            />
          </div>

          <DataTable<Member>
            caption="Loading members"
            columns={[
              {
                id: "name",
                header: "Name",
                cell: (row) => row.name,
              },
              {
                id: "email",
                header: "Email",
                cell: (row) => row.email,
              },
              {
                id: "organization",
                header: "Organization",
                cell: (row) => row.organization,
              },
            ]}
            rows={[]}
            rowKey={(row) => row.id}
            loading
            loadingRows={4}
          />

          <DataTable<Member>
            caption="Empty members"
            columns={[
              {
                id: "name",
                header: "Name",
                cell: (row) => row.name,
              },
              {
                id: "email",
                header: "Email",
                cell: (row) => row.email,
              },
            ]}
            rows={[]}
            rowKey={(row) => row.id}
            empty={
              <div>
                <p>No members yet. Invite members to get started.</p>
              </div>
            }
          />
        </>
      );
    },
  },

  {
    id: "navigation",
    title: "Navigation",
    note: "Page headers, tabs, breadcrumbs, panels, pagination, and progress indicators.",
    render: () => {
      const [currentPage, setCurrentPage] = useState(1);

      return (
        <>
          {/* The first region of every portal page: trail, subject, its
              standing as badges, and its actions on the right. */}
          <PageHeader
            trail={[{ label: "Groups", href: "#" }, { label: "Post-Quantum Cryptography" }]}
            title="Post-Quantum Cryptography"
            context={
              <>
                <Badge tone="neutral">Working group</Badge>
                <Badge tone="ok">Active</Badge>
              </>
            }
            actions={
              <>
                <Button size="sm" variant="secondary">
                  Export roster
                </Button>
                <Button size="sm" variant="primary">
                  Add member
                </Button>
              </>
            }
            description="Coordinates the consortium's migration to quantum-safe certificates."
          />

          <Tabs
            items={[
              { id: "members", label: "Members", href: "#" },
              { id: "settings", label: "Settings", href: "#" },
              { id: "audit", label: "Audit Log", href: "#" },
            ]}
            activeId="members"
            label="Navigation"
          />

          <Breadcrumb
            items={[
              { label: "Home", href: "#" },
              { label: "Working Groups", href: "#" },
              { label: "Post-Quantum Cryptography" },
            ]}
          />

          <Panel>
            <PanelHeader title="Group Settings" />
            <PanelBody>
              <p>Settings content goes here.</p>
            </PanelBody>
          </Panel>

          <Pager
            page={currentPage}
            pageCount={12}
            total={284}
            rangeStart={(currentPage - 1) * 25 + 1}
            rangeEnd={Math.min(currentPage * 25, 284)}
            onSelect={setCurrentPage}
            label="Member pagination"
          />

          <div class="pk-preview__shelf--stack">
            <Meter label="Storage usage" value={65} tone="accent" showValue />
            <Meter label="Compliance status" value={92} tone="ok" showValue />
            <Meter label="Certificate warnings" value={35} tone="warn" showValue />
            <Meter label="Critical errors" value={8} tone="danger" showValue />
          </div>
        </>
      );
    },
  },

  {
    id: "overlays",
    title: "Overlays",
    note: "Transient notifications and confirmations.",
    render: () => (
      <div class="pk-preview__shelf--stack">
        <Toast tone="ok" message="Certificate approved and activated." />
        <Toast tone="info" message="Your profile has been updated. Changes will appear shortly." />
        <Toast tone="danger" message="Certificate renewal failed. Please try again or contact support." />
        <Toast
          tone="ok"
          message="Member invited successfully."
          action={{
            label: "Undo",
            onSelect: () => {},
          }}
        />
        <Toast tone="info" message="New feature available: Enhanced audit logging." onDismiss={() => {}} />
      </div>
    ),
  },
];
