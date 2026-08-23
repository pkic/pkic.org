// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { z } from "zod";
import {
  useAppendableServerCollection,
  type AppendableServerCollectionState,
  type CollectionLoader,
} from "../../assets/ts/hooks/useServerCollection";

const responseSchema = z.object({
  items: z.array(z.object({ id: z.string() })),
  page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
});
type Response = z.infer<typeof responseSchema>;
type State = AppendableServerCollectionState<Response>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const merge = (current: Response, next: Response): Response => ({
  items: [...current.items, ...next.items],
  page: next.page,
});

function Harness(props: {
  endpoint?: string;
  identity: string;
  load: CollectionLoader;
  onState: (state: State) => void;
  nextOffset?: (data: Response) => number;
}) {
  const state = useAppendableServerCollection({
    endpoint: props.endpoint ?? "/api/items",
    params: { identity: props.identity },
    pageSize: 1,
    responseSchema,
    load: props.load,
    merge,
    nextOffset: props.nextOffset,
  });
  props.onState(state);
  return null;
}

function response(id: string, offset: number, hasMore = false): Response {
  return { items: [{ id }], page: { limit: 1, offset, total: hasMore ? 2 : 1, hasMore } };
}

function deferredLoader(requests: Map<string, Deferred<Response>>): CollectionLoader {
  return function load<T>(url: string): Promise<T> {
    const request = deferred<Response>();
    requests.set(url, request);
    return request.promise as Promise<T>;
  };
}

describe("useAppendableServerCollection request ordering", () => {
  const mounted: HTMLElement[] = [];

  afterEach(() => {
    for (const container of mounted.splice(0)) {
      void act(() => render(null, container));
      container.remove();
    }
  });

  it("invalidates an earlier page when the collection identity changes", async () => {
    const requests = new Map<string, Deferred<Response>>();
    const load = deferredLoader(requests);
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);

    await act(() => render(h(Harness, { identity: "old", load, onState: (state) => (latest = state) }), container));
    await act(() => render(h(Harness, { identity: "new", load, onState: (state) => (latest = state) }), container));

    requests.get("/api/items?identity=new&limit=1&offset=0")!.resolve(response("new", 0));
    await act(flush);
    requests.get("/api/items?identity=old&limit=1&offset=0")!.resolve(response("old", 0));
    await act(flush);

    expect(latest.data?.items.map((item) => item.id)).toEqual(["new"]);
  });

  it("invalidates an earlier page when the endpoint changes", async () => {
    const requests = new Map<string, Deferred<Response>>();
    const load = deferredLoader(requests);
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);

    await act(() =>
      render(
        h(Harness, { endpoint: "/api/old", identity: "same", load, onState: (state) => (latest = state) }),
        container,
      ),
    );
    await act(() =>
      render(
        h(Harness, { endpoint: "/api/new", identity: "same", load, onState: (state) => (latest = state) }),
        container,
      ),
    );

    requests.get("/api/new?identity=same&limit=1&offset=0")!.resolve(response("new", 0));
    await act(flush);
    requests.get("/api/old?identity=same&limit=1&offset=0")!.resolve(response("old", 0));
    await act(flush);

    expect(latest.data?.items.map((item) => item.id)).toEqual(["new"]);
  });

  it("does not append a stale load-more response after a reload", async () => {
    const requests = new Map<string, Deferred<Response>>();
    const load = deferredLoader(requests);
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);

    await act(() => render(h(Harness, { identity: "same", load, onState: (state) => (latest = state) }), container));
    requests.get("/api/items?identity=same&limit=1&offset=0")!.resolve(response("first", 0, true));
    await act(flush);

    const append = latest.loadMore();
    const reload = latest.reload();
    requests.get("/api/items?identity=same&limit=1&offset=0")!.resolve(response("fresh", 0));
    await act(flush);
    requests.get("/api/items?identity=same&limit=1&offset=1")!.resolve(response("stale", 1));
    await act(async () => {
      await Promise.all([append, reload]);
      await flush();
    });

    expect(latest.data?.items.map((item) => item.id)).toEqual(["fresh"]);
    expect(latest.page?.offset).toBe(0);
  });

  it("uses a response-specific next offset for grouped or transformed collections", async () => {
    const requests = new Map<string, Deferred<Response>>();
    const load = deferredLoader(requests);
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);

    await act(() =>
      render(
        h(Harness, {
          identity: "grouped",
          load,
          nextOffset: (data) => data.items.length,
          onState: (state) => (latest = state),
        }),
        container,
      ),
    );
    requests
      .get("/api/items?identity=grouped&limit=1&offset=0")!
      .resolve({ items: [{ id: "first" }], page: { limit: 200, offset: 0, total: 2, hasMore: true } });
    await act(flush);

    const append = latest.loadMore();
    requests.get("/api/items?identity=grouped&limit=1&offset=1")!.resolve(response("second", 1));
    await act(async () => {
      await append;
      await flush();
    });

    expect(latest.data?.items.map((item) => item.id)).toEqual(["first", "second"]);
  });
});
