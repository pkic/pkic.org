// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { useData } from "../../assets/ts/hooks/useData";
import { useRevisionEffect } from "../../assets/ts/hooks/useRevisionEffect";

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

  it("keeps the fetcher generation until dependencies change and reloads the current generation", async () => {
    const calls = vi.fn(async (resource: string, captured: string) => `${resource}:${captured}`);
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);
    function Inline({ resource, captured }: { resource: string; captured: string }) {
      latest = useData(() => calls(resource, captured), [resource]);
      return null;
    }
    const show = async (resource: string, captured: string) => {
      await act(() => render(<Inline resource={resource} captured={captured} />, container));
      await act(flush);
    };
    await show("one", "original");
    expect(latest.data).toBe("one:original");
    await show("one", "rerendered");
    expect(calls).toHaveBeenCalledTimes(1);
    await act(async () => latest.reload());
    expect(calls).toHaveBeenLastCalledWith("one", "original");
    await show("two", "new");
    expect(calls).toHaveBeenCalledTimes(3);
    expect(latest.data).toBe("two:new");
    await act(async () => latest.reload());
    expect(calls).toHaveBeenLastCalledWith("two", "new");
  });

  it("refetches on a dependency change even when the fetcher has stable identity", async () => {
    const fetcher = vi.fn(async () => "result");
    const container = document.createElement("div");
    mounted.push(container);
    function Stable({ resource }: { resource: string }) {
      useData(fetcher, [resource]);
      return null;
    }
    await act(() => render(<Stable resource="one" />, container));
    await act(flush);
    await act(() => render(<Stable resource="two" />, container));
    await act(flush);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not publish a pending response after unmount", async () => {
    const request = deferred<string>();
    const observed = vi.fn();
    const container = document.createElement("div");
    mounted.push(container);
    await act(() => render(<Harness resourceId="one" fetcher={() => request.promise} onState={observed} />, container));
    await act(() => render(null, container));
    const countAfterUnmount = observed.mock.calls.length;
    request.resolve("late");
    await act(flush);
    expect(observed).toHaveBeenCalledTimes(countAfterUnmount);
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
  it("retains same-resource data during a temporary failure but clears it on access refusal or resource change", async () => {
    const requests: Deferred<string>[] = [];
    const fetcher = () => {
      const request = deferred<string>();
      requests.push(request);
      return request.promise;
    };
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);
    const show = (resourceId: string) =>
      act(() => render(h(Harness, { resourceId, fetcher, onState: (state) => (latest = state) }), container));
    await show("first");
    requests[0].resolve("Authorized cached view");
    await act(flush);
    let reloading = latest.reload();
    await act(flush);
    expect(latest.data).toBe("Authorized cached view");
    expect(latest.loading).toBe(false);
    expect(latest.refreshing).toBe(true);
    requests[1].reject(
      new ApiClientError({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Temporarily unavailable" } }, 503),
    );
    await act(async () => {
      await reloading;
    });
    expect(latest.data).toBe("Authorized cached view");
    expect(latest.error).toBe("Temporarily unavailable");
    reloading = latest.reload();
    requests[2].reject(new ApiClientError({ error: { code: "FORBIDDEN", message: "Access removed" } }, 403));
    await act(async () => {
      await reloading;
    });
    expect(latest.data).toBeNull();
    await show("second");
    expect(latest.data).toBeNull();
    requests[3].resolve("Second resource");
    await act(flush);
    expect(latest.data).toBe("Second resource");
  });

  it("lets an editor own a failed post-save refresh without discarding its draft, then accepts a retry", async () => {
    const refusal = new ApiClientError({ error: { code: "FORBIDDEN", message: "Access removed" } }, 403);
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("original")
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce("refreshed")
      .mockRejectedValueOnce(refusal);
    let latest!: State;
    const container = document.createElement("div");
    mounted.push(container);
    await act(() =>
      render(<Harness resourceId="same" fetcher={fetcher} onState={(state) => (latest = state)} />, container),
    );
    await act(flush);
    await act(async () => {
      await expect(latest.refresh()).rejects.toBe(refusal);
    });
    expect(latest.data).toBe("original");
    expect(latest.error).toBeNull();
    expect(latest.refreshing).toBe(false);
    await act(async () => latest.refresh());
    expect(latest.data).toBe("refreshed");
    await act(async () => latest.reload());
    expect(latest.data).toBeNull();
    expect(latest.error).toBe("Access removed");
  });
});

describe("useRevisionEffect", () => {
  it("runs on mount and revision changes with the latest record, not on same-revision refreshes", async () => {
    const reset = vi.fn();
    const host = document.createElement("div");
    function RecordDraft({ revision, name }: { revision: string; name: string }) {
      useRevisionEffect(() => reset(name), revision);
      return null;
    }
    try {
      await act(() => render(<RecordDraft revision="1" name="initial" />, host));
      expect(reset).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenLastCalledWith("initial");
      await act(() => render(<RecordDraft revision="1" name="refreshed" />, host));
      expect(reset).toHaveBeenCalledTimes(1);
      await act(() => render(<RecordDraft revision="2" name="latest" />, host));
      expect(reset).toHaveBeenCalledTimes(2);
      expect(reset).toHaveBeenLastCalledWith("latest");
    } finally {
      await act(() => render(null, host));
    }
  });
});
