import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useColumnControls } from "../../assets/ts/components/table-column-controls";
import { eventAttendanceRegistrationsQuerySchema } from "../../assets/shared/schemas/event-registrations";
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
    const onFilterPatch = vi.fn();
    const container = mount(
      <DataTable
        caption="Pipeline"
        columns={columns()}
        data={rows}
        currentSort="stage"
        onSort={onSort}
        filters={{ stage: "contacted" }}
        onFilterPatch={onFilterPatch}
      />,
    );

    const popup = openMenu(container, "Stage column options");
    expect(itemLabels(popup)).toEqual(["Sort ascending", "Sort descending", "Filter ›", "Hide column"]);
    void act(() => popup.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    const submenu = popup.querySelector<HTMLElement>('[role="menu"]')!;
    expect(itemLabels(submenu)).toEqual(["All stages", "Contacted", "New inquiry"]);
    const checked = [...submenu.querySelectorAll('[aria-checked="true"]')].map((item) => item.textContent!.trim());
    expect(checked).toEqual(["✓Contacted"]);
    void act(() => submenu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[2].click());
    expect(onFilterPatch).toHaveBeenCalledWith({ stage: "new_inquiry" });
  });

  it("states the value a column is narrowed to under its name", () => {
    const container = mount(
      <DataTable
        caption="Pipeline"
        columns={columns()}
        data={rows}
        filters={{ stage: "contacted" }}
        onFilterPatch={vi.fn()}
      />,
    );
    const stageHead = [...container.querySelectorAll("th")].find((th) => th.textContent!.includes("Stage"));
    expect(stageHead?.querySelector("[data-column-filter]")?.textContent).toBe("Contacted");
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
    expect(container.querySelector(".pk-applied-filters")).toBeNull();

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

it("toggles several header choices independently, keeps the menu open and clears the complete selection", () => {
  const changed = vi.fn();
  const scoped = columns();
  scoped[1]!.filter = {
    param: "stage",
    multiple: true,
    options: [
      { value: "", label: "All stages" },
      { value: "contacted", label: "Contacted" },
      { value: "new_inquiry", label: "New inquiry" },
    ],
    match: {
      param: "match",
      options: [
        { value: "", label: "Any selected value" },
        { value: "all", label: "All selected values" },
      ],
    },
  };
  const container = mount(
    <DataTable
      caption="Pipeline"
      columns={scoped}
      data={rows}
      filters={{ stage: "contacted" }}
      onFilterPatch={changed}
    />,
  );
  const trigger = openMenu(container, "Stage column options");
  const filter = trigger.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  void act(() => filter.click());
  const choice = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"], [role="menuitemradio"]')].find(
      (button) => button.textContent?.replace(/^✓/, "").trim() === name,
    )!;
  expect(choice("Contacted").getAttribute("aria-checked")).toBe("true");
  expect(choice("New inquiry").getAttribute("aria-checked")).toBe("false");
  void act(() => choice("New inquiry").click());
  expect(changed).toHaveBeenLastCalledWith({ stage: "contacted,new_inquiry" });
  expect(container.querySelector('[role="menu"]')).not.toBeNull();
  void act(() => choice("Contacted").click());
  expect(changed).toHaveBeenLastCalledWith({ stage: "" });
  void act(() => choice("All selected values").click());
  expect(changed).toHaveBeenLastCalledWith({ match: "all" });
  void act(() => choice("All stages").click());
  expect(changed).toHaveBeenLastCalledWith({ stage: "" });
});

it("applies scoped filters atomically on a bare table", () => {
  const changed = vi.fn();
  const scoped = columns();
  scoped[1]!.filter = { ...scoped[1]!.filter!, scope: { answerField: "stage" } };
  const container = mount(<DataTable caption="Pipeline" columns={scoped} data={rows} onFilterPatch={changed} />);
  const popup = openMenu(container, "Stage column options");
  void act(() => popup.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
  void act(() =>
    [...popup.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((item) => item.textContent?.includes("Contacted"))!
      .click(),
  );
  expect(changed).toHaveBeenCalledExactlyOnceWith({ answerField: "stage", stage: "contacted" });
});

it("hides an open typed filter when shared controls lose their filter capability", () => {
  const changed = vi.fn();
  function SharedTable({ enabled }: { enabled: boolean }) {
    const cols: Column<Row>[] = [
      {
        header: "Job title",
        cell: (row) => row.name,
        filter: {
          param: "job_title",
          text: { schema: eventAttendanceRegistrationsQuerySchema.pick({ job_title: true }) },
        },
      },
    ];
    const controls = useColumnControls(cols, { onFilterPatch: enabled ? changed : undefined });
    return (
      <>
        <button type="button" onClick={() => controls.setFilterOpen("job_title")}>
          Open filter
        </button>
        <DataTable caption="Shared" columns={cols} data={rows} controls={controls} />
      </>
    );
  }
  const container = mount(<SharedTable enabled />);
  void act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector("input")).not.toBeNull();
  void act(() => render(<SharedTable enabled={false} />, container));
  expect(container.querySelector("input")).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});
