import { useState } from "preact/hooks";
import type { PreviewSection } from "./PreviewShell";
import { Breadcrumb } from "../Breadcrumb";
import { DataTable } from "../DataTable";
import { Field } from "../Field";
import { Menu, type MenuItem } from "../Menu";
import { Meter } from "../Meter";
import { Pager } from "../Pager";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import { Select, Textarea, TextInput } from "../TextControl";
import { Tabs } from "../Tabs";
import { Toast } from "../Toast";

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
        <div style={{ maxWidth: "24rem" }}>
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
        </div>
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
    note: "Tabs, breadcrumbs, panels, pagination, and progress indicators.",
    render: () => {
      const [currentPage, setCurrentPage] = useState(1);

      return (
        <>
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
