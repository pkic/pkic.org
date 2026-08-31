// @vitest-environment jsdom
/**
 * URL-addressed list state carried inside the hash (`#/users?users.q=…`): a
 * namespaced query segment initializes the table, state changes mirror back
 * into the hash, and unmount removes only the namespace's own keys so
 * parameters never leak onto the next page.
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
  history.replaceState(null, "", "/portal/#/things");
});

const responseSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
  page: pageInfoSchema,
});

function stubList(urls: string[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [{ id: "1", name: "Row one" }],
          page: { limit: 50, offset: 0, total: 120, hasMore: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
}

function table() {
  return (
    <ApiDataTable
      endpoint="/api/v1/things"
      responseSchema={responseSchema}
      resolve={(response) => response.items}
      resolvePage={(response) => response.page}
      searchPlaceholder="Search things…"
      urlState="things"
      paginate
      columns={[{ header: { label: "Name" }, cell: (row: { name: string }) => row.name }]}
    />
  );
}

describe("URL-addressed table state", () => {
  it("initializes search, sort, and page from the namespaced query string", async () => {
    history.replaceState(null, "", "/portal/#/things?things.q=alpha&things.sort=-name&things.offset=50");
    const urls: string[] = [];
    stubList(urls);
    mount(table());
    await settle();
    const request = new URL(urls[0], location.origin);
    expect(request.searchParams.get("q")).toBe("alpha");
    expect(request.searchParams.get("sort")).toBe("-name");
    expect(request.searchParams.get("offset")).toBe("50");
  });

  it("mirrors a typed search into the URL and clears its keys on unmount", async () => {
    const urls: string[] = [];
    stubList(urls);
    const container = mount(table());
    await settle();
    const input = container.querySelector<HTMLInputElement>("input[type=search]")!;
    await act(async () => {
      input.value = "beta";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(new URLSearchParams(location.hash.split("?")[1] ?? "").get("things.q")).toBe("beta");

    await act(() => render(null, container));
    expect(new URLSearchParams(location.hash.split("?")[1] ?? "").get("things.q")).toBeNull();
  });

  it("leaves other namespaces' parameters untouched", async () => {
    history.replaceState(null, "", "/portal/#/things?other.q=keep");
    const urls: string[] = [];
    stubList(urls);
    const container = mount(table());
    await settle();
    await act(() => render(null, container));
    expect(new URLSearchParams(location.hash.split("?")[1] ?? "").get("other.q")).toBe("keep");
  });
});
