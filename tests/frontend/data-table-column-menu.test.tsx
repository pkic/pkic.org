import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "../../assets/ts/components/Table";

interface Row {
  name: string;
  stage: string;
}

const rows: Row[] = [
  { name: "Ada", stage: "contacted" },
  { name: "Grace", stage: "new_inquiry" },
];

const mounted: HTMLElement[] = [];

function mount(ui: preact.JSX.Element): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(ui, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    render(null, container);
    container.remove();
  }
});

function columns(): Column<Row>[] {
  return [
    { header: "Name", cell: (row) => row.name, sort: { asc: "name", desc: "-name" } },
    {
      header: "Stage",
      cell: (row) => row.stage,
      sort: { asc: "stage", desc: "-stage" },
      filter: {
        param: "stage",
        options: [
          { value: "", label: "All stages" },
          { value: "contacted", label: "Contacted" },
          { value: "new_inquiry", label: "New inquiry" },
        ],
      },
    },
    { header: "", cell: () => "…" },
  ];
}

function openMenu(container: HTMLElement, label: string): HTMLElement {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`no menu trigger named ${label}`);
  void act(() => trigger.click());
  const popup = container.querySelector<HTMLElement>('[role="menu"]');
  if (!popup) throw new Error("menu did not open");
  return popup;
}

function itemLabels(popup: HTMLElement): string[] {
  return [...popup.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].map((item) =>
    item.textContent!.replace(/^✓?\s*/, "").trim(),
  );
}

describe("column menus", () => {
  it("offers sort, filter and hide from one trigger per column, and marks what is in force", () => {
    const onSort = vi.fn();
    const onFilterChange = vi.fn();
    const container = mount(
      <DataTable
        caption="Pipeline"
        columns={columns()}
        data={rows}
        currentSort="stage"
        onSort={onSort}
        filters={{ stage: "contacted" }}
        onFilterChange={onFilterChange}
      />,
    );

    const popup = openMenu(container, "Stage column options");
    expect(itemLabels(popup)).toEqual([
      "Sort ascending",
      "Sort descending",
      "All stages",
      "Contacted",
      "New inquiry",
      "Hide column",
    ]);
    const checked = [...popup.querySelectorAll('[aria-checked="true"]')].map((item) => item.textContent!.trim());
    expect(checked).toEqual(["✓Sort ascending", "✓Contacted"]);

    void act(() => popup.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[4].click());
    expect(onFilterChange).toHaveBeenCalledWith("stage", "new_inquiry");
  });

  it("states the value a column is narrowed to under its name", () => {
    const container = mount(
      <DataTable
        caption="Pipeline"
        columns={columns()}
        data={rows}
        filters={{ stage: "contacted" }}
        onFilterChange={vi.fn()}
      />,
    );
    const stageHead = [...container.querySelectorAll("th")].find((th) => th.textContent!.includes("Stage"));
    expect(stageHead?.querySelector(".pk-table__head-filter")?.textContent).toBe("Contacted");
  });

  it("hides a column from its own menu and brings it back from the columns menu", () => {
    const container = mount(<DataTable caption="Pipeline" columns={columns()} data={rows} />);
    const headers = () => [...container.querySelectorAll("th")].map((th) => th.textContent!.trim());
    expect(headers().some((text) => text.startsWith("Stage"))).toBe(true);

    let popup = openMenu(container, "Stage column options");
    const hide = [...popup.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent!.trim() === "Hide column",
    );
    void act(() => hide!.click());
    expect(headers().some((text) => text.startsWith("Stage"))).toBe(false);

    popup = openMenu(container, "Choose columns");
    const stage = [...popup.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) =>
      b.textContent!.includes("Stage"),
    );
    expect(stage?.getAttribute("aria-checked")).toBe("false");
    void act(() => stage!.click());
    expect(headers().some((text) => text.startsWith("Stage"))).toBe(true);
  });

  it("never lets the subject column or the actions column be hidden", () => {
    const container = mount(<DataTable caption="Pipeline" columns={columns()} data={rows} onSort={vi.fn()} />);
    const popup = openMenu(container, "Name column options");
    expect(itemLabels(popup)).toEqual(["Sort ascending", "Sort descending"]);
    expect(container.querySelector('button[aria-label="Actions column options"]')).toBeNull();
    void act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Name column options"]')!.click());
    const columnsMenu = openMenu(container, "Choose columns");
    expect(itemLabels(columnsMenu)).toEqual(["Stage"]);
  });
});
