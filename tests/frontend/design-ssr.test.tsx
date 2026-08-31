// @vitest-environment node
/**
 * Every primitive must render on a server.
 *
 * This is the constraint the plan's endgame rests on: the same components are
 * meant to serve the authenticated portal client-side and the public pages
 * server-side through preact-render-to-string in the Worker. A component that
 * touches `window` or `document` while rendering cannot do that, and the
 * failure only shows up once the render pipeline exists — long after the
 * component was written.
 *
 * Deliberately NOT a jsdom test. It runs in the plain Node environment, so
 * there is no `window` and no `document` to accidentally lean on: a component
 * that reaches for either throws here, which is the whole point.
 */

import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";

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

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [{ id: "mh", name: "Marit Halvorsen" }];

const primitives: ReadonlyArray<[string, () => string]> = [
  ["Button", () => render(<Button variant="primary">Save</Button>)],
  ["Button, loading", () => render(<Button loading>Saving</Button>)],
  ["Badge", () => render(<Badge tone="ok">Active</Badge>)],
  [
    "Chip",
    () =>
      render(
        <Chip pressed onToggle={() => undefined}>
          Status
        </Chip>,
      ),
  ],
  ["Kicker", () => render(<Kicker>Working group</Kicker>)],
  [
    "Alert",
    () =>
      render(
        <Alert tone="warn" title="Heads up">
          Body
        </Alert>,
      ),
  ],
  ["Spinner", () => render(<Spinner label="Loading" />)],
  ["EmptyState", () => render(<EmptyState title="Nothing yet" body="It will appear here." />)],
  ["Avatar", () => render(<Avatar name="Marit Halvorsen" />)],
  ["PersonCell", () => render(<PersonCell name="Marit Halvorsen" email="m@example.test" />)],
  ["StatCard", () => render(<StatCard label="Members" value="42" note="6 more" trend="up" />)],
  [
    "Field with a text input",
    () =>
      render(
        <Field label="Contact" state="invalid" message="Enter an address.">
          {(control) => <TextInput {...control} />}
        </Field>,
      ),
  ],
  ["Field with a textarea", () => render(<Field label="Charter">{(control) => <Textarea {...control} />}</Field>)],
  [
    "Field with a select",
    () =>
      render(
        <Field label="Parent">
          {(control) => (
            <Select {...control}>
              <option>None</option>
            </Select>
          )}
        </Field>,
      ),
  ],
  ["Menu", () => render(<Menu label="Actions" items={[{ id: "a", label: "Open", onSelect: () => undefined }]} />)],
  [
    "DataTable",
    () =>
      render(
        <DataTable
          caption="Members"
          columns={[{ id: "name", header: "Member", cell: (row: Row) => row.name, sortable: true }]}
          rows={rows}
          rowKey={(row: Row) => row.id}
          sort={{ columnId: "name", direction: "asc" }}
          onSort={() => undefined}
          selection={{ selected: new Set<string>(), onChange: () => undefined, rowLabel: (key) => key }}
        />,
      ),
  ],
  [
    "Panel",
    () =>
      render(
        <Panel>
          <PanelHeader title="Members" />
          <PanelBody>Body</PanelBody>
        </Panel>,
      ),
  ],
  ["Tabs", () => render(<Tabs label="Views" activeId="a" items={[{ id: "a", label: "Overview", href: "#a" }]} />)],
  ["Breadcrumb", () => render(<Breadcrumb items={[{ label: "Groups", href: "#g" }, { label: "PQC" }]} />)],
  [
    "Pager",
    () => render(<Pager page={1} pageCount={3} total={42} rangeStart={1} rangeEnd={20} onSelect={() => undefined} />),
  ],
  ["Meter", () => render(<Meter label="Level" value={3} max={5} />)],
  ["Toast", () => render(<Toast tone="ok" message="Saved." />)],
  [
    "Dialog, closed",
    () =>
      render(
        <Dialog
          open={false}
          title="Confirm"
          confirmLabel="Yes"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      ),
  ],
];

describe("server rendering", () => {
  it("has no DOM globals, so a component that reaches for one fails here", () => {
    expect(typeof globalThis.document).toBe("undefined");
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
  });

  for (const [name, renderPrimitive] of primitives) {
    it(`${name} renders to markup`, () => {
      const html = renderPrimitive();
      expect(html).toBeTypeOf("string");
      expect(html.length).toBeGreaterThan(0);
      // A component that swallowed its own error would render an empty shell.
      expect(html).toMatch(/<[a-z]/);
    });
  }

  it("produces markup that carries the accessibility contract, not just tags", () => {
    const field = render(
      <Field label="Contact" state="invalid" message="Enter an address.">
        {(control) => <TextInput {...control} />}
      </Field>,
    );
    expect(field).toContain('aria-invalid="true"');
    expect(field).toContain("aria-describedby");

    const table = render(
      <DataTable
        caption="Members"
        columns={[{ id: "name", header: "Member", cell: (row: Row) => row.name, sortable: true }]}
        rows={rows}
        rowKey={(row: Row) => row.id}
        sort={{ columnId: "name", direction: "asc" }}
        onSort={() => undefined}
      />,
    );
    expect(table).toContain('aria-sort="ascending"');
    expect(table).toContain("<caption");
  });

  it("renders no inline style attributes, which a stylesheet-linked page cannot rely on", () => {
    for (const [name, renderPrimitive] of primitives) {
      expect(renderPrimitive(), name).not.toContain(" style=");
    }
  });
});
