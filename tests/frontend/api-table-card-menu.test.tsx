// @vitest-environment jsdom
/**
 * A list drawn as record cards has no column heads to hang its sort and
 * filter menus on, so the same commands collapse into one menu in the list's
 * toolbar. The stylesheet shows that menu only in the card layout; here the
 * menu's contents and its shared state with the column menus are checked.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { pageInfoSchema } from "../../assets/shared/schemas/pagination";
import { ApiDataTable } from "../../assets/ts/components/ApiDataTable";
import { CollectionToolbar } from "../../assets/ts/components/CollectionToolbar";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  history.replaceState(null, "", location.pathname);
});

const responseSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), stage: z.string() })),
  page: pageInfoSchema,
});

function stubList(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          items: [{ id: "1", name: "Ada", stage: "contacted" }],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function table(narrowLayout?: "records" | "columns", customCards = false) {
  return (
    <ApiDataTable
      urlState="api-table-card-menu"
      caption="Contacts"
      endpoint="/api/v1/contacts"
      responseSchema={responseSchema}
      resolve={(response) => response.items}
      resolvePage={(response) => response.page}
      rowKey={(row) => row.id}
      narrowLayout={narrowLayout}
      renderItems={
        customCards
          ? (rows) => (
              <div>
                {rows.map((row) => (
                  <article key={row.id}>{row.name}</article>
                ))}
              </div>
            )
          : undefined
      }
      columns={[
        { header: "Name", cell: (row) => row.name, sort: { asc: "name", desc: "-name" } },
        {
          header: "Stage",
          cell: (row) => row.stage,
          filter: {
            param: "stage",
            options: [
              { value: "", label: "All stages" },
              { value: "contacted", label: "Contacted" },
            ],
          },
        },
        { header: "Hidden", cell: () => "x", sort: { asc: "hidden", desc: "-hidden" }, defaultHidden: true },
      ]}
    />
  );
}

function labels(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((item) =>
    item
      .textContent!.replace(/^✓?\s*/, "")
      .replace(/\s*›$/, "")
      .trim(),
  );
}

describe("record-card sort and filter menu", () => {
  it("retains sort/filter controls for custom discovery cards on desktop", async () => {
    stubList();
    const container = mount(table("columns", true));
    await settle();
    expect(container.querySelector(".pk-table-list__card-menu--always")).not.toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Sort and filter contacts"]')!;
    await act(async () => trigger.click());
    expect(labels(container, '[role="menuitem"]')).toEqual(["Sort by Name", "Filter by Stage"]);
  });
  it("collapses the visible columns' sort and filter commands into one toolbar menu", async () => {
    const fetchMock = stubList();
    const container = mount(table());
    await settle();

    const toolbar = container.querySelector('[role="toolbar"][aria-label="Contacts controls"]')!;
    const trigger = toolbar.querySelector<HTMLButtonElement>('button[aria-label="Sort and filter contacts"]');
    expect(trigger).not.toBeNull();
    // The visible words are part of the accessible name (WCAG 2.5.3).
    expect(trigger!.textContent).toContain("Sort and filter");
    expect(toolbar.querySelector(".pk-table-list__card-menu")).not.toBeNull();

    await act(async () => trigger!.click());
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
    // A hidden column is out of the cards, so it is out of their menu too.
    expect(labels(menu, '[role="menuitem"]')).toEqual(["Sort by Name", "Filter by Stage"]);

    await act(async () => menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    const directions = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(directions.map((item) => item.textContent!.replace(/^✓?\s*/, "").trim())).toEqual([
      "Ascending",
      "Descending",
    ]);
    await act(async () => directions[1]!.click());
    await settle();
    const lastUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), location.origin);
    expect(lastUrl.searchParams.get("sort")).toBe("-name");
  });

  it("offers no card menu for a list that keeps its columns on a narrow screen", async () => {
    stubList();
    const container = mount(table("columns"));
    await settle();
    expect(container.querySelector(".pk-table-list__card-menu")).toBeNull();
  });
});

describe("collection create action", () => {
  it("writes the label beside the plus when the list asks for it", () => {
    const onSelect = vi.fn();
    const container = mount(
      <CollectionToolbar label="Shifts controls" createAction={{ label: "New shift", onSelect, showLabel: true }} />,
    );
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "New shift",
    );
    expect(button).toBeDefined();
    expect(button!.getAttribute("aria-label")).toBeNull();
    void act(() => button!.click());
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
