// @vitest-environment jsdom
/**
 * The shared list toolbar owns the create affordance: `createAction` renders
 * "New …" in the same bar as search and refresh, permission-gated by simply
 * omitting the prop. Create forms never render in the default view.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { pageInfoSchema } from "../../assets/shared/schemas/pagination";
import { ApiDataTable } from "../../assets/ts/components/ApiDataTable";

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
});

const responseSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
  page: pageInfoSchema,
});

function stubList(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [{ id: "1", name: "Row one" }],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
}

function table(createAction?: { label: string; onSelect: () => void; disabled?: boolean }) {
  return (
    <ApiDataTable
      caption="Things"
      endpoint="/api/v1/things"
      responseSchema={responseSchema}
      resolve={(response) => response.items}
      resolvePage={(response) => response.page}
      searchPlaceholder="Search things…"
      createAction={createAction}
      columns={[{ header: { label: "Name" }, cell: (row: { name: string }) => row.name }]}
    />
  );
}

describe("ApiDataTable createAction", () => {
  it("renders the create button beside search and refresh and fires its handler", async () => {
    stubList();
    let created = 0;
    const container = mount(table({ label: "New thing", onSelect: () => (created += 1) }));
    await settle();

    // The toolbar is found by its role and by the name the caption gives it,
    // so the assertion survives the next change of presentational classes.
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute("aria-label")).toBe("Things controls");
    const buttons = [...(toolbar?.querySelectorAll("button") ?? [])].map((button) => button.textContent);
    expect(buttons).toEqual(["New thing", "Refresh"]);
    expect(toolbar?.querySelector("input[type=search]")).not.toBeNull();

    await act(() => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "New thing")?.click();
    });
    expect(created).toBe(1);
  });

  it("omits the create button entirely when the viewer may not create", async () => {
    stubList();
    const container = mount(table(undefined));
    await settle();
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Refresh"]);
  });

  it("disables the create button when the action is disabled", async () => {
    stubList();
    const container = mount(table({ label: "New thing", onSelect: () => {}, disabled: true }));
    await settle();
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "New thing");
    expect(button?.disabled).toBe(true);
  });
});
