// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { paginatedResponseSchema } from "../../assets/shared/schemas/pagination";
import { ServerSearchSelect } from "../../assets/ts/components/ServerSearchSelect";
import type { CollectionLoader } from "../../assets/ts/hooks/useServerCollection";
import type { ServerCatalog } from "../../assets/ts/shared/server-catalog";
import { chooseComboboxOption, controlFor, openCombobox } from "./helpers/labelled-control";

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

/** Advances fake time inside `act`, flushing timers and settled promises. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // Effects flushed when `act` exits can start requests of their own; two
  // zero-length rounds let those settle without moving the clock further.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Types into the combobox the way the browser would: set, then notify. */
async function typeSearch(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function press(input: HTMLInputElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

function optionLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "");
}

function pagedItems(url: URL, total: number): CatalogResponse {
  const limit = Number(url.searchParams.get("limit"));
  const offset = Number(url.searchParams.get("offset"));
  return {
    items: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({
      id: `item-${offset + index}`,
      name: `Item ${offset + index}`,
    })),
    page: { limit, offset, total, hasMore: offset + limit < total },
  };
}

function stubFetch(handler: (url: URL) => Response | Promise<Response>): URL[] {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      requests.push(url);
      return handler(url);
    }),
  );
  return requests;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ServerSearchSelect", () => {
  it("queries once after the typing pause, not per keystroke, and never for a single character", async () => {
    vi.useFakeTimers();
    const requests = stubFetch((url) => json(pagedItems(url, 201)));
    const onChange = vi.fn();
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={onChange} />,
    );
    await elapse(0);

    // The first page loads once, unfiltered, so the list can open before any
    // typing and `autoSelectFirst` callers have something to select.
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("active")).toBe("true");
    expect(requests[0].searchParams.get("sort")).toBe("name");
    expect(requests[0].searchParams.get("limit")).toBe("25");
    expect(requests[0].searchParams.has("q")).toBe(false);

    const input = controlFor(container, "Working group");
    // One character is below the minimum, so even a full pause sends nothing.
    await typeSearch(input, "s");
    await elapse(400);
    expect(requests).toHaveLength(1);

    // Three keystrokes inside the pause are one query, not three.
    await typeSearch(input, "se");
    await elapse(100);
    await typeSearch(input, "sec");
    await elapse(100);
    await typeSearch(input, "security");
    expect(requests).toHaveLength(1);
    await elapse(300);
    expect(requests).toHaveLength(2);
    expect(requests[1].searchParams.get("q")).toBe("security");
    expect(requests[1].searchParams.get("offset")).toBe("0");

    // Typing opened the listbox, and a truncated result set says so in words.
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Showing 25 of 201 matches. Keep typing to narrow the list.");
  });

  it("discards a slower earlier response instead of letting it overwrite newer matches", async () => {
    vi.useFakeTimers();
    const pending: Array<{ url: string; resolve: (response: CatalogResponse) => void }> = [];
    const load: CollectionLoader = <T,>(url: string, _signal: AbortSignal, schema: z.ZodType<T>) =>
      new Promise<T>((resolve) => {
        pending.push({ url, resolve: (response) => resolve(schema.parse(response)) });
      });
    const page = { limit: 25, offset: 0, total: 1, hasMore: false };
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={() => {}} load={load} />,
    );
    await elapse(0);
    pending.shift()!.resolve({ items: [{ id: "first", name: "First" }], page });
    await elapse(0);

    const input = controlFor(container, "Working group");
    await typeSearch(input, "alpha");
    await elapse(300);
    const stale = pending.shift()!;
    expect(new URL(stale.url, location.origin).searchParams.get("q")).toBe("alpha");

    await typeSearch(input, "alphabet");
    await elapse(300);
    const fresh = pending.shift()!;
    expect(new URL(fresh.url, location.origin).searchParams.get("q")).toBe("alphabet");

    // The newer query answers first; the older one limps in afterwards and
    // must change nothing.
    fresh.resolve({ items: [{ id: "fresh", name: "Fresh match" }], page });
    await elapse(0);
    stale.resolve({ items: [{ id: "stale", name: "Stale match" }], page });
    await elapse(0);

    const labels = optionLabels(container);
    expect(labels).toContain("Fresh match");
    expect(labels).not.toContain("Stale match");
  });

  it("selects with the keyboard: ArrowDown highlights, Enter chooses, Escape closes and restores", async () => {
    vi.useFakeTimers();
    stubFetch((url) => json(pagedItems(url, 2)));
    const onChange = vi.fn();
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={onChange} />,
    );
    await elapse(0);

    const input = controlFor(container, "Working group");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await press(input, "ArrowDown");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    // The first option is the pick-nothing placeholder; the highlight is
    // announced through `aria-activedescendant`, never by moving focus.
    const first = container.querySelector('[role="option"]')!;
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.textContent).toBe("Select…");

    await press(input, "ArrowDown");
    const active = container.querySelector(`[id="${input.getAttribute("aria-activedescendant")!}"]`);
    expect(active?.textContent).toBe("Item 0");

    await press(input, "Enter");
    expect(onChange).toHaveBeenCalledWith({ id: "item-0", name: "Item 0" });
    expect(input.getAttribute("aria-expanded")).toBe("false");

    // Escape closes without choosing and puts the typed text back to rest.
    await press(input, "ArrowDown");
    await typeSearch(input, "zz");
    await press(input, "Escape");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("selects with the pointer and shows the chosen label in the closed input", async () => {
    vi.useFakeTimers();
    stubFetch((url) => json(pagedItems(url, 3)));
    function Harness() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <ServerSearchSelect
          catalog={catalog}
          label="Working group"
          value={value}
          onChange={(item) => setValue(item ? item.id : null)}
        />
      );
    }
    const container = mount(<Harness />);
    await elapse(0);

    await chooseComboboxOption(container, "Working group", "item-1");
    const input = controlFor(container, "Working group");
    expect(input.value).toBe("Item 1");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    // Reopening marks the current choice as the selected option.
    const options = await openCombobox(container, "Working group");
    const selected = options.find((option) => option.getAttribute("aria-selected") === "true");
    expect(selected?.getAttribute("data-key")).toBe("item-1");
  });

  it("names the combobox through its label and the listbox through aria-controls", async () => {
    vi.useFakeTimers();
    stubFetch((url) => json(pagedItems(url, 1)));
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={() => {}} />,
    );
    await elapse(0);

    // Resolving the control through the label itself fails exactly when the
    // `for`/`id` pair is broken.
    const input = controlFor(container, "Working group");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-haspopup")).toBe("listbox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");

    await press(input, "ArrowDown");
    const listbox = container.querySelector('[role="listbox"]')!;
    expect(listbox.getAttribute("aria-label")).toBe("Working group");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
  });

  it("says in words when nothing matches the typed term", async () => {
    vi.useFakeTimers();
    stubFetch((url) =>
      json(
        url.searchParams.has("q")
          ? { items: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }
          : pagedItems(url, 1),
      ),
    );
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={() => {}} />,
    );
    await elapse(0);

    const input = controlFor(container, "Working group");
    await typeSearch(input, "zzz");
    await elapse(300);

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("No matches for “zzz”.");
  });

  it("preserves a selected value that is outside the current server page", async () => {
    vi.useFakeTimers();
    stubFetch((url) => json(pagedItems(url, 201)));
    const container = mount(
      <ServerSearchSelect
        catalog={catalog}
        label="Event"
        value="item-200"
        selectedLabel="Current event"
        onChange={() => {}}
      />,
    );
    await elapse(0);

    expect(controlFor(container, "Event").value).toBe("Current event");
  });

  it("does not carry the previous term into a different catalog filter", async () => {
    vi.useFakeTimers();
    const requests = stubFetch((url) => json(pagedItems(url, 50)));

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
    await elapse(0);
    const input = controlFor(container, "Working group");
    await typeSearch(input, "security");
    await elapse(300);
    expect(requests.at(-1)?.searchParams.get("q")).toBe("security");

    const requestsBeforeToggle = requests.length;
    await act(async () => {
      (container.querySelector("[data-toggle]") as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(400);
    });
    const filterRequests = requests.slice(requestsBeforeToggle);
    expect(filterRequests).toHaveLength(1);
    expect(filterRequests[0].searchParams.get("active")).toBe("false");
    expect(filterRequests[0].searchParams.has("q")).toBe(false);
    // The stale term is gone from the input as well as from the wire.
    expect(input.value).toBe("");
  });

  it("auto-selects the first item from the initial unfiltered page when asked", async () => {
    vi.useFakeTimers();
    stubFetch((url) => json(pagedItems(url, 3)));
    const onChange = vi.fn();
    mount(
      <ServerSearchSelect
        catalog={catalog}
        label="Role"
        value={null}
        allowEmpty={false}
        autoSelectFirst
        onChange={onChange}
      />,
    );
    await elapse(0);

    expect(onChange).toHaveBeenCalledWith({ id: "item-0", name: "Item 0" });
  });

  it("announces a failed load as an error rather than as differently coloured result text", async () => {
    vi.useFakeTimers();
    stubFetch(() => json({ error: "nope" }, 503));
    const container = mount(
      <ServerSearchSelect catalog={catalog} label="Working group" value={null} onChange={() => {}} />,
    );
    await elapse(0);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("503");
  });
});
