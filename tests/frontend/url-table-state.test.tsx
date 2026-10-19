// @vitest-environment jsdom
/**
 * URL-addressed list state carried inside the hash (`#/users?users.q=…`): a
 * namespaced query segment restores the table through history navigation,
 * and unmount preserves the bookmark rather than editing an incoming route.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { pageInfoSchema } from "../../assets/shared/schemas/pagination";
import { ApiDataTable } from "../../assets/ts/components/ApiDataTable";
import { writeUrlQuery, subscribeUrlQuery } from "../../assets/ts/ui/url-query";
import { useUrlTableState } from "../../assets/ts/hooks/useUrlTableState";

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
      caption="Things"
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
  it("lets a namespace owner preserve its query without mounting a table or making requests", async () => {
    function Owner() {
      useUrlTableState("things");
      return <p>Workspace</p>;
    }
    history.replaceState(null, "", "/portal/#/things?things.q=kept&things.f.state=active&other.q=other");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const container = mount(<Owner />);
    await settle();
    expect(location.hash).toContain("things.q=kept");
    expect(location.hash).toContain("things.f.state=active");
    expect(fetcher).not.toHaveBeenCalled();
    await act(() => render(null, container));
    expect(location.hash).toBe("#/things?things.q=kept&things.f.state=active&other.q=other");
  });
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

  it("mirrors a typed search into the URL and preserves its keys on unmount", async () => {
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
    expect(new URLSearchParams(location.hash.split("?")[1] ?? "").get("things.q")).toBe("beta");
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
  it("reads history navigation and remounts from the same namespaced bookmark", async () => {
    const defaults = { q: "", sort: "name", offset: 0, pageSize: 50, filters: {} };
    function Probe() {
      const state = useUrlTableState("things", defaults);
      return <output>{JSON.stringify(state.initial)}</output>;
    }
    history.replaceState(null, "", "/portal/#/things?things.q=alpha&things.offset=50&other=keep");
    const container = mount(<Probe />);
    expect(container.textContent).toContain('"q":"alpha"');
    history.pushState(null, "", "/portal/#/things?things.q=beta&things.f.state=active&other=keep");
    await act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(container.textContent).toContain('"q":"beta"');
    expect(container.textContent).toContain('"state":"active"');
    history.back();
    await vi.waitFor(() => expect(container.textContent).toContain('"q":"alpha"'));
    expect(container.textContent).toContain('"offset":50');
    await act(() => render(null, container));
    const refreshed = mount(<Probe />);
    expect(refreshed.textContent).toContain('"q":"alpha"');
    expect(location.hash).toContain("other=keep");
  });

  it("ignores a delayed outgoing mirror and preserves an incoming route's namespace", async () => {
    let mirror: (state: {
      q: string;
      sort: string;
      offset: number;
      pageSize: number;
      filters: Record<string, string>;
    }) => void;
    function Probe() {
      mirror = useUrlTableState("things", { q: "", sort: "name", offset: 0, pageSize: 50, filters: {} }).mirror;
      return <p>List</p>;
    }
    history.replaceState(null, "", "/portal/#/things?things.q=old");
    const container = mount(<Probe />);
    const outgoing = mirror!;
    history.replaceState(null, "", "/portal/#/new?things.q=bookmarked&other=keep");
    await act(() => outgoing({ q: "stale", sort: "name", offset: 0, pageSize: 50, filters: {} }));
    await act(() => render(null, container));
    expect(location.hash).toBe("#/new?things.q=bookmarked&other=keep");
  });
  it("restores the mounted table's actual search and request page on browser navigation", async () => {
    history.replaceState(null, "", "/portal/#/things?things.q=alpha&things.offset=50");
    const urls: string[] = [];
    stubList(urls);
    const container = mount(table());
    await settle();
    history.pushState(null, "", "/portal/#/things?things.q=beta&things.offset=100");
    await act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    expect(container.querySelector<HTMLInputElement>("input[type=search]")?.value).toBe("beta");
    expect(new URL(urls.at(-1)!, location.origin).searchParams.get("offset")).toBe("100");
    history.back();
    await vi.waitFor(() =>
      expect(container.querySelector<HTMLInputElement>("input[type=search]")?.value).toBe("alpha"),
    );
    // history.back() restores outside act, so the request effect runs on Preact's after-paint schedule.
    await vi.waitFor(() => expect(new URL(urls.at(-1)!, location.origin).searchParams.get("offset")).toBe("50"));
    expect(location.hash).toContain("things.q=alpha");
  });

  it("shares guarded natural path and query writes between public pages and the hash router", async () => {
    history.replaceState(null, "", "/events/demo/agenda/?utm=keep#speaker");
    const changed = vi.fn();
    const stop = subscribeUrlQuery(changed);
    writeUrlQuery({
      source: "search",
      ownerPath: "/events/demo/agenda/",
      destinationPath: "/events/demo/agenda/speakers/",
      params: new URLSearchParams("utm=keep&q=alpha"),
      mode: "push",
    });
    expect(location.pathname).toBe("/events/demo/agenda/speakers/");
    expect(location.search).toBe("?utm=keep&q=alpha");
    expect(location.hash).toBe("#speaker");
    writeUrlQuery({ source: "search", ownerPath: "/events/demo/agenda/", params: new URLSearchParams("q=stale") });
    expect(location.search).toBe("?utm=keep&q=alpha");
    history.replaceState(null, "", "/portal/?utm=keep#/events/demo/agenda?mine=1");
    const routeChanged = vi.fn();
    window.addEventListener("hashchange", routeChanged);
    writeUrlQuery({
      source: "hash",
      ownerPath: "/events/demo/agenda",
      destinationPath: "/events/demo/agenda/speakers",
      params: new URLSearchParams("mine=1"),
      mode: "push",
    });
    expect(location.hash).toBe("#/events/demo/agenda/speakers?mine=1");
    expect(location.search).toBe("?utm=keep");
    expect(routeChanged).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalled();
    expect(() =>
      writeUrlQuery({
        source: "search",
        ownerPath: "/portal/",
        destinationPath: "//external.test",
        params: new URLSearchParams(),
      }),
    ).toThrow();
    window.removeEventListener("hashchange", routeChanged);
    stop();
  });
  it("omits all configured defaults when a list mirrors its opening state", async () => {
    const defaults = { q: "", sort: "name", offset: 0, pageSize: 50, filters: { state: "active" } };
    let mirror: (state: typeof defaults) => void;
    function Probe() {
      mirror = useUrlTableState("things", defaults).mirror;
      return <p>List</p>;
    }
    history.replaceState(null, "", "/portal/#/things?other=keep");
    mount(<Probe />);
    await act(() => mirror!(defaults));
    expect(location.hash).toBe("#/things?other=keep");
  });
  it("keeps an explicitly cleared default filter cleared after remount", async () => {
    const defaults = { q: "", sort: "name", offset: 0, pageSize: 50, filters: { state: "active", kind: "member" } };
    let mirror: (state: {
      q: string;
      sort: string;
      offset: number;
      pageSize: number;
      filters: Record<string, string>;
    }) => void;
    function Probe() {
      const url = useUrlTableState("things", defaults);
      mirror = url.mirror;
      return <output>{JSON.stringify(url.initial.filters)}</output>;
    }
    history.replaceState(null, "", "/portal/#/things");
    const container = mount(<Probe />);
    await act(() => mirror!({ ...defaults, filters: { kind: "member" } }));
    expect(container.textContent).toBe('{"kind":"member"}');
    await act(() => render(null, container));
    const refreshed = mount(<Probe />);
    expect(refreshed.textContent).toBe('{"kind":"member"}');
    expect(location.hash).toContain("things.f.state=");
    expect(location.hash).not.toContain("things.f.kind");
  });
});
