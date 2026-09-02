// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { donationsListResponseSchema } from "../../assets/shared/schemas/donation-management";
import { pageInfoSchema } from "../../assets/shared/schemas/pagination";
import { ApiDataTable } from "../../assets/ts/components/ApiDataTable";
import { Donations } from "../../assets/ts/member-flows/portal/sections/system-donations/Donations";
import { Pager } from "../../assets/ts/components/Pager";
import { useApiPage } from "../../assets/ts/hooks/useApiPage";
import { useOffsetPager } from "../../assets/ts/hooks/useOffsetPager";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

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

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pageFor(url: URL, total = 60, rowCount = 1) {
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return { limit, offset, total, hasMore: offset + rowCount < total };
}

function nextButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
}

/** The sort control of a column, which is a button in its column header. */
function sortButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("th button")];
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("canonical offset pagination", () => {
  it("enforces first and last bounds, bounded jumps, totals, and page-size resets", () => {
    let pager: ReturnType<typeof useOffsetPager> | undefined;
    function Harness() {
      pager = useOffsetPager(25);
      return null;
    }
    mount(<Harness />);

    let props = pager!.pagerProps({ hasMore: true, rowCount: 25, total: 60 });
    expect(props).toMatchObject({ page: 1, pageSize: 25, offset: 0, rowCount: 25, total: 60, hasMore: true });
    void act(() => props.onPrev());
    expect(pager!.offset).toBe(0);

    void act(() => props.onJump(99));
    expect(pager!.offset).toBe(50);
    props = pager!.pagerProps({ hasMore: false, rowCount: 10, total: 60, serverOffset: 50 });
    expect(props.page).toBe(3);
    void act(() => props.onNext());
    expect(pager!.offset).toBe(50);

    void act(() => props.onJump(-4));
    expect(pager!.offset).toBe(0);
    void act(() => pager!.pagerProps({ hasMore: true, rowCount: 25, total: 60 }).onPageSizeChange(50));
    expect(pager!.pageSize).toBe(50);
    expect(pager!.offset).toBe(0);

    void act(() => pager!.pagerProps({ hasMore: true, rowCount: 50, total: 60 }).onNext());
    expect(pager!.offset).toBe(50);
    void act(() => pager!.resetAll());
    expect(pager!.pageSize).toBe(25);
    expect(pager!.offset).toBe(0);
  });

  it("drives useApiPage and resets a stale page when collection parameters change", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse({ items: [{ id: url.searchParams.get("offset") ?? "0" }], page: pageFor(url) });
      }),
    );
    const responseSchema = z.object({ items: z.array(z.object({ id: z.string() })), page: pageInfoSchema });

    function Harness() {
      const [filter, setFilter] = useState("open");
      const listing = useApiPage("/api/items", { filter }, responseSchema, (data) => data.items, 25);
      return (
        <div>
          <button data-filter onClick={() => setFilter("closed")}>
            Filter
          </button>
          {listing.pagerProps && <Pager {...listing.pagerProps} />}
        </div>
      );
    }

    const container = mount(<Harness />);
    await settle();
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("25");
    expect(container.querySelector(".pk-pager__summary")?.textContent).toBe("1–1 of 60");

    void act(() => nextButton(container).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");

    const requestsBeforeFilter = requests.length;
    void act(() => (container.querySelector("[data-filter]") as HTMLButtonElement).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("filter")).toBe("closed");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(requests.slice(requestsBeforeFilter)).toHaveLength(1);
  });

  it("keeps generic portal group search server-side while paging the joined view", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse({
          groups: [{ id: url.searchParams.get("offset") ?? "0" }],
          page: pageFor(url, 60),
        });
      }),
    );
    const responseSchema = z.object({
      groups: z.array(z.object({ id: z.string() })),
      page: pageInfoSchema,
    });

    function Harness() {
      const listing = useApiPage(
        "/api/v1/users/current/groups",
        { view: "joined", q: "alpha" },
        responseSchema,
        (data) => data.groups,
        25,
      );
      return <>{listing.pagerProps && <Pager {...listing.pagerProps} />}</>;
    }

    const container = mount(<Harness />);
    await settle();
    expect(requests.at(-1)?.searchParams.get("view")).toBe("joined");
    expect(requests.at(-1)?.searchParams.has("typeKey")).toBe(false);
    expect(requests.at(-1)?.searchParams.get("q")).toBe("alpha");
    void act(() => nextButton(container).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");
    expect(requests.at(-1)?.searchParams.get("q")).toBe("alpha");
  });

  it("makes ApiDataTable reset pagination for filters, search, and sorting", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse({ rows: [{ id: "row", name: "Ada" }], page: pageFor(url) });
      }),
    );
    const responseSchema = z.object({
      rows: z.array(z.object({ id: z.string(), name: z.string() })),
      page: pageInfoSchema,
    });

    function Harness() {
      const [status, setStatus] = useState("open");
      return (
        <div>
          <button data-filter onClick={() => setStatus("closed")}>
            Filter
          </button>
          <ApiDataTable
            caption="Table rows"
            endpoint="/api/table"
            responseSchema={responseSchema}
            resolve={(data) => data.rows}
            resolvePage={(data) => data.page}
            params={{ status }}
            paginate
            initialPageSize={25}
            searchPlaceholder="Search"
            columns={[
              {
                header: "Name",
                cell: (row) => row.name,
                sort: { asc: "name", desc: "-name" },
              },
            ]}
            rowKey={(row) => row.id}
          />
        </div>
      );
    }

    const container = mount(<Harness />);
    await settle();
    void act(() => nextButton(container).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("25");

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = "Ada";
    void act(() => {
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    void act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Ada");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");

    void act(() => nextButton(container).click());
    await settle();
    void act(() => sortButtons(container)[0].click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("sort")).toBe("-name");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");

    void act(() => nextButton(container).click());
    await settle();
    const requestsBeforeFilter = requests.length;
    void act(() => (container.querySelector("[data-filter]") as HTMLButtonElement).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("status")).toBe("closed");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(requests.slice(requestsBeforeFilter)).toHaveLength(1);
  });

  it("publishes table summary data after load without updating state during render", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        return jsonResponse(
          donationsListResponseSchema.parse({
            donations: [
              {
                id: "donation-1",
                checkout_session_id: "cs_test_1",
                payment_intent_id: null,
                name: "Ada Lovelace",
                email: "ada@example.test",
                organization: null,
                currency: "usd",
                gross_amount: 1000,
                net_amount: null,
                source: null,
                status: "completed",
                payment_method_type: null,
                session_expires_at: null,
                settled_amount: null,
                settled_currency: null,
                created_at: "2026-01-01T00:00:00Z",
                completed_at: "2026-01-01T00:00:00Z",
              },
            ],
            page: pageFor(url, 1),
            summary: { byStatus: { completed: 1 }, backfillable: 0, syncable: 0 },
          }),
        );
      }),
    );

    const container = mount(<Donations />);
    await settle();

    // The summary reaches the Status column's filter menu as counts.
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Status column options"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const all = [...container.querySelectorAll('[role="menuitemradio"]')].find((item) =>
      item.textContent?.includes("All"),
    );
    expect(all?.textContent).toContain("All (1)");
    expect(requests).toHaveLength(1);
  });
});
