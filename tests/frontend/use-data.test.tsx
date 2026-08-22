// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useData } from "../../assets/ts/hooks/useData";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type State = ReturnType<typeof useData<string>>;

function Harness(props: {
  resourceId: string;
  fetcher: (resourceId: string) => Promise<string>;
  onState: (state: State) => void;
}) {
  const state = useData(() => props.fetcher(props.resourceId), [props.resourceId, props.fetcher]);
  props.onState(state);
  return null;
}

describe("useData request ordering", () => {
  const mounted: HTMLElement[] = [];

  afterEach(() => {
    for (const container of mounted.splice(0)) {
      void act(() => render(null, container));
      container.remove();
    }
  });

  it("does not let an older dependency request overwrite the current resource", async () => {
    const requests = new Map<string, Deferred<string>>();
    const fetcher = (resourceId: string) => {
      const request = deferred<string>();
      requests.set(resourceId, request);
      return request.promise;
    };
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);

    await act(() =>
      render(h(Harness, { resourceId: "old", fetcher, onState: (state) => (latest = state) }), container),
    );
    await act(() =>
      render(h(Harness, { resourceId: "new", fetcher, onState: (state) => (latest = state) }), container),
    );

    requests.get("new")!.resolve("new response");
    await act(flush);
    expect(latest.data).toBe("new response");

    requests.get("old")!.resolve("stale response");
    await act(flush);
    expect(latest.data).toBe("new response");
    expect(latest.error).toBeNull();
  });

  it("keeps the latest manual reload when reloads finish out of order", async () => {
    const requests: Deferred<string>[] = [];
    const fetcher = () => {
      const request = deferred<string>();
      requests.push(request);
      return request.promise;
    };
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);

    await act(() =>
      render(h(Harness, { resourceId: "same", fetcher, onState: (state) => (latest = state) }), container),
    );
    requests[0].resolve("initial");
    await act(flush);

    const firstReload = latest.reload();
    const secondReload = latest.reload();
    requests[2].resolve("latest");
    await act(flush);
    requests[1].reject(new Error("stale failure"));
    await act(async () => {
      await Promise.all([firstReload, secondReload]);
      await flush();
    });

    expect(latest.data).toBe("latest");
    expect(latest.error).toBeNull();
    expect(latest.loading).toBe(false);
  });
});
