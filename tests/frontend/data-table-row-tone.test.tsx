// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { DataTable, type Column } from "../../assets/ts/components/Table";
import { progressStep, type ToneProps } from "../../assets/ts/ui/tone";

interface Row {
  name: string;
  stage: ToneProps;
}

const rows: Row[] = [
  { name: "Digitorus", stage: { tone: "info", progress: 0.25 } },
  { name: "Northwind CA", stage: { tone: "warn" } },
];

const columns: Column<Row>[] = [{ header: "Applicant", cell: (row) => row.name }];

const mounted: HTMLElement[] = [];

function bodyRows(ui: preact.JSX.Element): HTMLTableRowElement[] {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(ui, container));
  return [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")];
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    render(null, container);
    container.remove();
  }
});

describe("row tone", () => {
  it("marks each row's edge with its tone by default", () => {
    const [first, second] = bodyRows(
      <DataTable caption="Applications" columns={columns} data={rows} rowTone={(row) => row.stage} />,
    );
    expect(first!.className).toContain("pk-tone--info");
    expect(first!.className).toContain("pk-tone--fade-1");
    expect(first!.className).toContain("pk-table__row--edge");
    expect(second!.className).toContain("pk-tone--warn");
  });

  it("tints the row when asked", () => {
    const [first] = bodyRows(
      <DataTable
        caption="Applications"
        columns={columns}
        data={rows}
        rowTone={(row) => row.stage}
        rowToneStyle="tint"
      />,
    );
    expect(first!.className).toContain("pk-table__row--tint");
  });

  it("leaves rows untoned without a row tone", () => {
    const [first] = bodyRows(<DataTable caption="Applications" columns={columns} data={rows} />);
    expect(first!.className).not.toContain("pk-tone--");
  });
});

describe("progressStep", () => {
  it("clamps progress into four steps", () => {
    expect([-1, 0, 0.25, 0.26, 0.5, 0.75, 1, 2].map(progressStep)).toEqual([1, 1, 1, 2, 2, 3, 4, 4]);
  });
});
