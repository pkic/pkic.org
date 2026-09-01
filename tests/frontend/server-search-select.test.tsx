// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { paginatedResponseSchema } from "../../assets/shared/schemas/pagination";
import { ServerSearchSelect } from "../../assets/ts/components/ServerSearchSelect";
import type { ServerCatalog } from "../../assets/ts/shared/server-catalog";
import { buttonNamed, controlFor } from "./helpers/labelled-control";

const itemSchema = z.object({ id: z.string(), name: z.string() });
const responseSchema = paginatedResponseSchema("items", itemSchema);
type Item = z.infer<typeof itemSchema>;
type CatalogResponse = z.infer<typeof responseSchema>;

const catalog: ServerCatalog<Item, CatalogResponse> = {
  endpoint: "/api/items",
  responseSchema,
  resolveItems: (response) => response.items,
  resolvePage: (response) => response.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => item.name,
  params: { active: "true" },
  sort: "name",
};

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

describe("ServerSearchSelect", () => {
  it("queries and pages the server without failing when the catalogue exceeds 200 rows", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        const limit = Number(url.searchParams.get("limit"));
        const offset = Number(url.searchParams.get("offset"));
        return new Response(
          JSON.stringify({
            items: Array.from({ length: Math.min(limit, 201 - offset) }, (_, index) => ({
              id: `item-${offset + index}`,
              name: `Item ${offset + index}`,
            })),
            page: { limit, offset, total: 201, hasMore: offset + limit < 201 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const onChange = vi.fn();
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={onChange} />,
    );
    await settle();

    expect(container.textContent).toContain("1–25 of 201");
    expect(requests.at(-1)?.searchParams.get("active")).toBe("true");
    expect(requests.at(-1)?.searchParams.get("sort")).toBe("name");

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = "security";
    void act(() => {
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Located by the name the button announces rather than by the wrapper's
    // class, which is styling and will change again.
    void act(() => buttonNamed(container, "Search").click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("security");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");

    const next = [...container.querySelectorAll("button")].find((button) => button.textContent === "Next")!;
    void act(() => next.click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");
  });

  it("preserves a selected value that is outside the current server page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ id: "item-0", name: "Item 0" }],
              page: { limit: 25, offset: 0, total: 201, hasMore: true },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const container = mount(
      <ServerSearchSelect
        catalog={catalog}
        label="Event"
        value="item-200"
        selectedLabel="Current event"
        onChange={() => {}}
      />,
    );
    await settle();

    const selected = container.querySelector('option[value="item-200"]') as HTMLOptionElement;
    expect(selected.textContent).toBe("Current event");
    expect(selected.selected).toBe(true);
  });

  it("does not request a new catalogue filter with the previous page offset", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return new Response(
          JSON.stringify({
            items: [{ id: `item-${url.searchParams.get("offset") ?? "0"}`, name: "Item" }],
            page: { limit: 25, offset: Number(url.searchParams.get("offset") ?? 0), total: 50, hasMore: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    function Harness() {
      const [active, setActive] = useState("true");
      const nextCatalog = { ...catalog, params: { active } };
      return (
        <>
          <button data-toggle onClick={() => setActive("false")}>
            Toggle
          </button>
          <ServerSearchSelect catalog={nextCatalog} label="Working group" value={null} onChange={() => {}} />
        </>
      );
    }

    const container = mount(<Harness />);
    await settle();
    const next = [...container.querySelectorAll("button")].find((button) => button.textContent === "Next")!;
    void act(() => next.click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");

    const requestsBeforeToggle = requests.length;
    void act(() => (container.querySelector("[data-toggle]") as HTMLButtonElement).click());
    await settle();
    const filterRequests = requests.slice(requestsBeforeToggle);
    expect(filterRequests).toHaveLength(1);
    expect(filterRequests[0].searchParams.get("active")).toBe("false");
    expect(filterRequests[0].searchParams.get("offset")).toBe("0");
  });

  it("announces a failed load as an error rather than as differently coloured result text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "nope" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={() => {}} />,
    );
    await settle();

    // The version this replaces put the failure in the same sentence as the
    // result count and separated the two by colour alone, which is not a
    // status anyone who cannot tell red from grey can read. A failure is now
    // its own region, announced as one.
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("503");
    // Paging is still reachable, so a transient failure is not a dead end.
    expect(buttonNamed(container, "Previous").disabled).toBe(true);
  });

  it("names its select through the `for`/`id` pair the visible label promises", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ id: "item-0", name: "Item 0" }],
              page: { limit: 25, offset: 0, total: 1, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={() => {}} />,
    );
    await settle();

    // Resolving the control through the label itself fails exactly when the
    // pair is broken — which is what the bare `<label>` this replaces was.
    expect(controlFor<HTMLSelectElement>(container, "Working group").tagName.toLowerCase()).toBe("select");
    // The search field keeps a name of its own, distinct from the select's, so
    // a page holding several selectors does not announce four "Search" boxes.
    const search = container.querySelector('input[type="search"]');
    expect(search?.getAttribute("aria-label")).toBe("Working group search");
    // Its paging controls stay a named group rather than two loose buttons.
    expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Working group result pages");
  });
});
