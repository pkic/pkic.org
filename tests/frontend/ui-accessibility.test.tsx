// @vitest-environment jsdom
/**
 * Automated accessibility checks across every primitive.
 *
 * axe catches a specific, useful class of defect — missing names, broken ARIA
 * relationships, invalid role nesting — and catches it on every future change
 * without anyone remembering to look. It is a floor, not a ceiling: keyboard
 * behaviour and focus order are asserted in each component's own test file,
 * because axe cannot press a key.
 *
 * Colour-contrast rules are disabled here and only here. jsdom computes no
 * layout and resolves no custom properties, so every contrast result would be
 * a fabrication. Contrast is a property of the token pairs and is verified
 * against the real values in tests/frontend/design-contrast.test.ts.
 */

import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Alert } from "../../assets/ts/ui/Alert";
import { Avatar } from "../../assets/ts/ui/Avatar";
import { Badge } from "../../assets/ts/ui/Badge";
import { Breadcrumb } from "../../assets/ts/ui/Breadcrumb";
import { Button } from "../../assets/ts/ui/Button";
import { Chip } from "../../assets/ts/ui/Chip";
import { DataTable } from "../../assets/ts/ui/DataTable";
import { Dialog } from "../../assets/ts/ui/Dialog";
import { EmptyState } from "../../assets/ts/ui/EmptyState";
import { Field } from "../../assets/ts/ui/Field";
import { Kicker } from "../../assets/ts/ui/Kicker";
import { Menu } from "../../assets/ts/ui/Menu";
import { Meter } from "../../assets/ts/ui/Meter";
import { Pager } from "../../assets/ts/ui/Pager";
import { Panel, PanelBody, PanelHeader } from "../../assets/ts/ui/Panel";
import { PersonCell } from "../../assets/ts/ui/PersonCell";
import { Spinner } from "../../assets/ts/ui/Spinner";
import { StatCard } from "../../assets/ts/ui/StatCard";
import { Tabs } from "../../assets/ts/ui/Tabs";
import { Select, Textarea, TextInput } from "../../assets/ts/ui/TextControl";
import { Toast } from "../../assets/ts/ui/Toast";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("main");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

async function violationsIn(container: HTMLElement): Promise<string[]> {
  const results = await axe.run(container, {
    rules: {
      // See the file header: jsdom has no layout, so any contrast verdict here
      // would be invented. Contrast is checked against the real token values.
      "color-contrast": { enabled: false },
    },
  });
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
  );
}

const members = [
  { id: "mh", name: "Marit Halvorsen", organization: "Nordsec AS" },
  { id: "jo", name: "Jelani Okonkwo", organization: "Certpath Ltd" },
];

const specimens: ReadonlyArray<[string, () => ComponentChildren]> = [
  [
    "Button, every variant",
    () => (
      <div>
        <Button variant="primary">Save</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="ghost">Skip</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="danger-quiet">Remove</Button>
        <Button variant="link">Open</Button>
        <Button loading>Saving</Button>
        <Button disabled>Unavailable</Button>
        <Button icon aria-label="More actions">
          <span aria-hidden="true">⋯</span>
        </Button>
      </div>
    ),
  ],
  [
    "Badge, every tone",
    () => (
      <div>
        <Badge tone="ok">Active</Badge>
        <Badge tone="warn">Invited</Badge>
        <Badge tone="danger">Ended</Badge>
        <Badge tone="info">Chair</Badge>
        <Badge tone="neutral">Member</Badge>
        <Badge tone="accent">Working group</Badge>
      </div>
    ),
  ],
  [
    "Chip",
    () => (
      <div>
        <Chip pressed onToggle={() => undefined}>
          Status: Active
        </Chip>
        <Chip onRemove={() => undefined} removeLabel="Capacity: Organization">
          Capacity: Organization
        </Chip>
      </div>
    ),
  ],
  ["Kicker", () => <Kicker>Working group</Kicker>],
  [
    "Alert, every tone",
    () => (
      <div>
        <Alert tone="info" title="Preview database">
          Changes here never reach production.
        </Alert>
        <Alert tone="ok" title="Saved">
          Members see the new charter immediately.
        </Alert>
        <Alert tone="warn" title="Two groups share a colour">
          CBOM Profiles and Training are both teal.
        </Alert>
        <Alert tone="danger" title="Could not end membership">
          Reload and try again.
        </Alert>
      </div>
    ),
  ],
  [
    "Spinner",
    () => (
      <div>
        <Spinner label="Loading members" />
        <Spinner label="Loading members" labelHidden />
      </div>
    ),
  ],
  [
    "EmptyState",
    () => (
      <EmptyState title="No votes are open" body="Ballots appear here until they close.">
        <Button variant="secondary">Open a vote</Button>
      </EmptyState>
    ),
  ],
  [
    "Avatar and PersonCell",
    () => (
      <div>
        <Avatar name="Marit Halvorsen" />
        <Avatar name="Marit Halvorsen" src="/img/example.png" />
        <PersonCell name="Marit Halvorsen" email="m.halvorsen@nordsec.example" />
      </div>
    ),
  ],
  [
    "StatCard",
    () => (
      <div>
        <StatCard label="Members" value="42" note="6 this quarter" trend="up" />
        <StatCard label="Attendance" value="78%" note="4 points" trend="down" />
        <StatCard label="Open votes" value="3" />
      </div>
    ),
  ],
  [
    "Field, every validation state",
    () => (
      <form>
        <Field label="Group name" required help="Shown on the public directory.">
          {(control) => <TextInput {...control} value="Post-Quantum Cryptography" />}
        </Field>
        <Field label="Primary contact" state="ok" message="Verified against the domain.">
          {(control) => <TextInput {...control} value="m.halvorsen@nordsec.example" />}
        </Field>
        <Field label="Personal address" state="advisory" message="A work address keeps access with your organization.">
          {(control) => <TextInput {...control} value="marit@example.com" />}
        </Field>
        <Field label="Deputy contact" state="invalid" message="Enter a complete email address.">
          {(control) => <TextInput {...control} value="not-an-address" />}
        </Field>
        <Field label="Charter summary">{(control) => <Textarea {...control} />}</Field>
        <Field label="Parent group">
          {(control) => (
            <Select {...control}>
              <option>None</option>
            </Select>
          )}
        </Field>
      </form>
    ),
  ],
  [
    "Menu, closed",
    () => (
      <Menu
        label="Actions for Marit Halvorsen"
        items={[{ id: "a", label: "Open profile", onSelect: () => undefined }]}
      />
    ),
  ],
  [
    "DataTable with selection and sorting",
    () => (
      <DataTable
        caption="Members of the Post-Quantum Cryptography working group"
        columns={[
          { id: "name", header: "Member", cell: (row) => <PersonCell name={row.name} />, sortable: true },
          { id: "organization", header: "Capacity", cell: (row) => row.organization },
          { id: "actions", header: "Actions", headerHidden: true, cell: () => null },
        ]}
        rows={members}
        rowKey={(row) => row.id}
        sort={{ columnId: "name", direction: "asc" }}
        onSort={() => undefined}
        selection={{
          selected: new Set(["mh"]),
          onChange: () => undefined,
          rowLabel: (key) => `Select ${key}`,
        }}
      />
    ),
  ],
  [
    "DataTable, loading",
    () => (
      <DataTable<(typeof members)[number]>
        caption="Members"
        columns={[{ id: "name", header: "Member", cell: (row) => row.name }]}
        rows={[]}
        rowKey={(row) => row.id}
        loading
      />
    ),
  ],
  [
    "Panel",
    () => (
      <Panel>
        <PanelHeader title="Members">
          <Button variant="primary" size="sm">
            Add member
          </Button>
        </PanelHeader>
        <PanelBody>Body</PanelBody>
      </Panel>
    ),
  ],
  [
    "Tabs",
    () => (
      <Tabs
        label="Group views"
        activeId="overview"
        items={[
          { id: "overview", label: "Overview", href: "#overview" },
          { id: "members", label: "Members", href: "#members" },
        ]}
      />
    ),
  ],
  [
    "Breadcrumb",
    () => (
      <Breadcrumb
        items={[
          { label: "Groups", href: "#groups" },
          { label: "Post-Quantum Cryptography", href: "#pqc" },
          { label: "Members" },
        ]}
      />
    ),
  ],
  [
    "Pager",
    () => <Pager page={3} pageCount={12} total={240} rangeStart={41} rangeEnd={60} onSelect={() => undefined} />,
  ],
  ["Meter", () => <Meter label="PQCMM level" value={3} max={5} />],
  [
    "Toast",
    () => (
      <Toast
        tone="ok"
        message="Membership ended."
        action={{ label: "Undo", onSelect: () => undefined }}
        onDismiss={() => undefined}
      />
    ),
  ],
  [
    "Dialog, destructive with typed confirmation",
    () => (
      <Dialog
        open
        destructive
        title="Remove Tomas Riedel from this group?"
        description="This ends the membership capacity immediately."
        consequences={["Access to group meetings stops", "Open ballots lose this vote"]}
        confirmPhrase="Post-Quantum Cryptography"
        confirmLabel="Remove member"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    ),
  ],
];

describe("accessibility", () => {
  for (const [name, renderSpecimen] of specimens) {
    it(`${name} has no axe violations`, async () => {
      const container = mount(renderSpecimen());
      const violations = await violationsIn(container);
      expect(violations, violations.join("\n")).toEqual([]);
    });
  }

  it("actually evaluates rules, so a passing suite is not a vacuous one", async () => {
    // A guard against the audit silently becoming a no-op — a misconfigured
    // axe run reports zero violations just as loudly as a clean one. The
    // threshold is measured, not guessed: a form field plus a table currently
    // exercises well over a dozen rules.
    const container = mount(
      <form>
        <Field label="Primary contact" state="invalid" message="Enter an address.">
          {(control) => <TextInput {...control} />}
        </Field>
      </form>,
    );
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    const evaluated = results.passes.length + results.violations.length + results.incomplete.length;
    expect(evaluated, `axe evaluated only ${String(evaluated)} rules`).toBeGreaterThanOrEqual(5);
    expect(results.violations).toEqual([]);
  });
});
