// @vitest-environment jsdom
/**
 * DataTable's contract.
 *
 * The table is presentational on purpose: it renders the page the server
 * returned and never reorders it. What it owns is the part screen readers
 * depend on — the sort state, the checkbox names, the caption, and saying
 * "busy" rather than miming it with grey rectangles.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { DataTable, type DataTableColumn } from "../../assets/ts/ui/DataTable";

interface Member {
  id: string;
  name: string;
  organization: string;
}

const rows: Member[] = [
  { id: "mh", name: "Marit Halvorsen", organization: "Nordsec AS" },
  { id: "jo", name: "Jelani Okonkwo", organization: "Certpath Ltd" },
  { id: "sb", name: "Sofia Beaumont", organization: "Quantalis SA" },
];

const columns: DataTableColumn<Member>[] = [
  { id: "name", header: "Member", cell: (row) => row.name, sortable: true },
  { id: "organization", header: "Capacity", cell: (row) => row.organization },
];

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
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

function headers(container: HTMLElement): HTMLTableCellElement[] {
  return [...container.querySelectorAll("th")];
}

describe("DataTable", () => {
  it("always renders a caption so the table is identifiable, hidden by default", () => {
    const container = mount(<DataTable caption="Members" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const caption = container.querySelector("caption");
    expect(caption?.textContent).toBe("Members");
    expect(caption?.className).toContain("pk-table__caption--hidden");
  });

  it("shows the caption when asked", () => {
    const container = mount(
      <DataTable caption="Members" showCaption columns={columns} rows={rows} rowKey={(r) => r.id} />,
    );
    expect(container.querySelector("caption")?.className).not.toContain("--hidden");
  });

  it("renders the rows it was given, in the order it was given them", () => {
    const container = mount(<DataTable caption="Members" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const names = [...container.querySelectorAll("tbody tr td:first-child")].map((cell) => cell.textContent);
    expect(names).toEqual(["Marit Halvorsen", "Jelani Okonkwo", "Sofia Beaumont"]);
  });

  it("marks only the sorted column with aria-sort", () => {
    const container = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: "name", direction: "asc" }}
        onSort={vi.fn()}
      />,
    );
    const [name, organization] = headers(container);
    expect(name.getAttribute("aria-sort")).toBe("ascending");
    expect(organization.getAttribute("aria-sort")).toBeNull();
  });

  it("asks for the opposite direction when the sorted column is clicked again", () => {
    const onSort = vi.fn();
    const container = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: "name", direction: "asc" }}
        onSort={onSort}
      />,
    );
    void act(() => container.querySelector<HTMLButtonElement>(".pk-table__sort")?.click());
    expect(onSort).toHaveBeenCalledWith("name", "desc");
  });

  it("asks for ascending when a different column is sorted", () => {
    const onSort = vi.fn();
    const container = mount(
      <DataTable
        caption="Members"
        columns={[...columns, { id: "joined", header: "Joined", cell: () => "2024", sortable: true }]}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ columnId: "name", direction: "desc" }}
        onSort={onSort}
      />,
    );
    const sortButtons = container.querySelectorAll<HTMLButtonElement>(".pk-table__sort");
    void act(() => sortButtons[sortButtons.length - 1].click());
    expect(onSort).toHaveBeenCalledWith("joined", "asc");
  });

  it("renders no sort control for a column that is not sortable", () => {
    const container = mount(
      <DataTable caption="Members" columns={columns} rows={rows} rowKey={(r) => r.id} onSort={vi.fn()} />,
    );
    expect(container.querySelectorAll(".pk-table__sort")).toHaveLength(1);
  });

  it("names every selection checkbox after the row it selects", () => {
    const container = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{
          selected: new Set<string>(),
          onChange: vi.fn(),
          rowLabel: (key) => `Select ${key}`,
        }}
      />,
    );
    const labels = [...container.querySelectorAll("tbody .pk-table__checkbox")].map((box) =>
      box.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Select mh", "Select jo", "Select sb"]);
  });

  it("puts the header checkbox in the indeterminate state for a partial selection", () => {
    const container = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{ selected: new Set(["mh"]), onChange: vi.fn(), rowLabel: (key) => key }}
      />,
    );
    const header = container.querySelector<HTMLInputElement>("thead .pk-table__checkbox");
    expect(header?.indeterminate).toBe(true);
    expect(header?.checked).toBe(false);
  });

  it("selects every row from the header, and clears them all when they are all selected", () => {
    const onChange = vi.fn();
    const container = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{ selected: new Set<string>(), onChange, rowLabel: (key) => key }}
      />,
    );
    void act(() => container.querySelector<HTMLInputElement>("thead .pk-table__checkbox")?.click());
    expect([...(onChange.mock.calls[0][0] as Set<string>)].sort()).toEqual(["jo", "mh", "sb"]);

    const allSelected = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{ selected: new Set(["mh", "jo", "sb"]), onChange, rowLabel: (key) => key }}
      />,
    );
    void act(() => allSelected.querySelector<HTMLInputElement>("thead .pk-table__checkbox")?.click());
    expect([...(onChange.mock.calls[1][0] as Set<string>)]).toEqual([]);
  });

  it("adds and removes a single row without disturbing the rest of the selection", () => {
    const onChange = vi.fn();
    const container = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{ selected: new Set(["mh"]), onChange, rowLabel: (key) => key }}
      />,
    );
    const boxes = container.querySelectorAll<HTMLInputElement>("tbody .pk-table__checkbox");
    void act(() => boxes[1].click());
    expect([...(onChange.mock.calls[0][0] as Set<string>)].sort()).toEqual(["jo", "mh"]);

    void act(() => boxes[0].click());
    expect([...(onChange.mock.calls[1][0] as Set<string>)]).toEqual([]);
  });

  it("announces that it is busy and hides the placeholder rows from assistive technology", () => {
    const container = mount(
      <DataTable caption="Members" columns={columns} rows={[]} rowKey={(r) => r.id} loading loadingRows={2} />,
    );
    expect(container.querySelector("table")?.getAttribute("aria-busy")).toBe("true");
    const placeholders = container.querySelectorAll(".pk-table__placeholder");
    expect(placeholders).toHaveLength(2);
    for (const placeholder of placeholders) {
      expect(placeholder.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("shows the empty state only when it is neither loading nor holding rows", () => {
    const empty = mount(
      <DataTable caption="Members" columns={columns} rows={[]} rowKey={(r) => r.id} empty={<p>No members yet</p>} />,
    );
    expect(empty.textContent).toContain("No members yet");

    const loading = mount(
      <DataTable
        caption="Members"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        loading
        empty={<p>No members yet</p>}
      />,
    );
    expect(loading.textContent).not.toContain("No members yet");

    const filled = mount(
      <DataTable caption="Members" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>No members yet</p>} />,
    );
    expect(filled.textContent).not.toContain("No members yet");
  });

  it("keeps a hidden header readable by assistive technology", () => {
    const container = mount(
      <DataTable
        caption="Members"
        columns={[...columns, { id: "actions", header: "Actions", headerHidden: true, cell: () => null }]}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    const actions = headers(container).at(-1);
    expect(actions?.textContent).toBe("Actions");
    expect(actions?.querySelector(".pk-table__sr")).not.toBeNull();
  });

  /*
   * Row activation. Fourteen portal list surfaces put an onClick on the <tr>,
   * which no keyboard can reach: a row is not focusable and takes no Enter
   * key. These assert the replacement is a real control.
   */
  describe("row activation", () => {
    it("renders a focusable, named link rather than a click handler on the row", () => {
      const container = mount(
        <DataTable
          caption="Organizations"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowAction={(row) => ({ label: `Open ${row.name}`, href: `/organizations/${row.id}` })}
        />,
      );

      const link = container.querySelector<HTMLAnchorElement>("tbody a");
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe("/organizations/mh");
      expect(link?.textContent).toBe("Open Marit Halvorsen");
      // A link is reachable by Tab and openable in a new tab; a <tr> is neither.
      expect(link?.tabIndex).toBe(0);
    });

    it("uses a button when the row selects rather than navigates", () => {
      const onSelect = vi.fn();
      const container = mount(
        <DataTable
          caption="Users"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowAction={(row) => ({ label: `View ${row.name}`, onSelect })}
        />,
      );

      const button = container.querySelector<HTMLButtonElement>("tbody button");
      expect(button?.type).toBe("button");
      expect(button?.textContent).toBe("View Marit Halvorsen");
      void act(() => button!.click());
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("puts the control in the first cell, ahead of the row's own actions", () => {
      const container = mount(
        <DataTable
          caption="Users"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowAction={() => ({ label: "Open", href: "/x" })}
        />,
      );
      const firstCell = container.querySelector("tbody td");
      expect(firstCell?.querySelector("a")).not.toBeNull();
    });

    it("leaves rows alone when no action is given for them", () => {
      const container = mount(
        <DataTable
          caption="Users"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowAction={(row) => (row.id === "mh" ? { label: "Open", href: "/x" } : undefined)}
        />,
      );
      const rendered = [...container.querySelectorAll("tbody tr")];
      expect(rendered[0].className).toContain("pk-table__row--action");
      expect(rendered[1].className).not.toContain("pk-table__row--action");
      expect(rendered[1].querySelector("a")).toBeNull();
    });
  });

  describe("detail rows", () => {
    it("spans every column, including the selection column", () => {
      const container = mount(
        <DataTable
          caption="Users"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          selection={{ selected: new Set(), onChange: vi.fn(), rowLabel: (key) => `Select ${key}` }}
          detailRow={(row) => (row.id === "mh" ? <p>Joined in 2019</p> : null)}
        />,
      );

      const detail = container.querySelector(".pk-table__detail");
      expect(detail?.textContent).toBe("Joined in 2019");
      expect(detail?.querySelector("td")?.getAttribute("colspan")).toBe(String(columns.length + 1));
    });

    it("emits no row at all for records that have no detail", () => {
      const container = mount(
        <DataTable caption="Users" columns={columns} rows={rows} rowKey={(row) => row.id} detailRow={() => null} />,
      );
      expect(container.querySelector(".pk-table__detail")).toBeNull();
    });
  });
});
