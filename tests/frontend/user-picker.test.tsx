// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserPicker } from "../../assets/ts/components/UserPicker";
import { getJson } from "../../assets/ts/shared/api-client";
import type { UserCatalogItem } from "../../assets/shared/schemas/user-catalog";

vi.mock("../../assets/ts/shared/api-client", () => ({ getJson: vi.fn() }));

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
  return Promise.resolve();
}

function user(id: string, email: string): UserCatalogItem {
  return {
    id,
    email,
    first_name: null,
    last_name: null,
    organization_name: null,
  };
}

describe("UserPicker request ordering", () => {
  const mounted: HTMLElement[] = [];

  afterEach(() => {
    for (const container of mounted.splice(0)) {
      void act(() => render(null, container));
      container.remove();
    }
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  async function mountPicker(endpoint?: string) {
    const container = document.createElement("div");
    mounted.push(container);
    await act(() => render(h(UserPicker, { value: null, onChange: vi.fn(), endpoint }), container));
    const input = container.querySelector("input") as HTMLInputElement;
    return { container, input };
  }

  async function search(input: HTMLInputElement, value: string) {
    input.value = value;
    await act(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }

  it("ignores an older successful response after a newer search result", async () => {
    vi.useFakeTimers();
    const oldRequest = deferred<{ users: UserCatalogItem[] }>();
    const newRequest = deferred<{ users: UserCatalogItem[] }>();
    vi.mocked(getJson)
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    const { container, input } = await mountPicker();

    await search(input, "old");
    await search(input, "new");

    await act(async () => {
      newRequest.resolve({ users: [user("new-id", "new@example.test")] });
      await flush();
    });
    expect(container.textContent).toContain("new@example.test");

    await act(async () => {
      oldRequest.resolve({ users: [user("old-id", "old@example.test")] });
      await flush();
    });
    expect(container.textContent).toContain("new@example.test");
    expect(container.textContent).not.toContain("old@example.test");
  });

  it("uses an explicit scoped catalog while retaining the canonical user source as the default", async () => {
    vi.useFakeTimers();
    vi.mocked(getJson).mockResolvedValue({ users: [] });
    const scoped = await mountPicker("/api/v1/groups/group%2Fone/users");
    expect(scoped.input.autocomplete).toBe("off");
    await search(scoped.input, "Ada Lovelace");
    const scopedUrl = new URL(String(vi.mocked(getJson).mock.calls[0][0]), "https://app.test");
    expect(scopedUrl.pathname).toBe("/api/v1/groups/group%2Fone/users");
    expect(Object.fromEntries(scopedUrl.searchParams)).toEqual({
      limit: "8",
      offset: "0",
      sort: "email",
      q: "Ada Lovelace",
    });

    vi.mocked(getJson).mockClear();
    const users = await mountPicker();
    await search(users.input, "admin@example.test");
    expect(new URL(String(vi.mocked(getJson).mock.calls[0][0]), "https://app.test").pathname).toBe("/api/v1/users");
  });

  it("does not clear a newer result when an older search fails", async () => {
    vi.useFakeTimers();
    const oldRequest = deferred<{ users: UserCatalogItem[] }>();
    const newRequest = deferred<{ users: UserCatalogItem[] }>();
    vi.mocked(getJson)
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    const { container, input } = await mountPicker();

    await search(input, "old");
    await search(input, "new");
    await act(async () => {
      newRequest.resolve({ users: [user("new-id", "new@example.test")] });
      await flush();
    });
    expect(container.textContent).toContain("new@example.test");

    await act(async () => {
      oldRequest.reject(new Error("stale failure"));
      await flush();
    });
    expect(container.textContent).toContain("new@example.test");
  });

  it("reports a current search failure", async () => {
    vi.useFakeTimers();
    vi.mocked(getJson).mockRejectedValueOnce(new Error("search unavailable"));
    const { container, input } = await mountPicker();

    await search(input, "missing");
    await act(async () => {
      await flush();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not search users.");
  });

  it("aborts an in-flight search when unmounted", async () => {
    vi.useFakeTimers();
    const request = deferred<{ users: UserCatalogItem[] }>();
    vi.mocked(getJson).mockImplementationOnce((_path, _schema, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return request.promise;
    });
    const { container, input } = await mountPicker();
    await search(input, "old");
    const signal = vi.mocked(getJson).mock.calls[0][2]?.signal;

    await act(() => render(null, container));
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      request.resolve({ users: [user("old-id", "old@example.test")] });
      await flush();
    });
    expect(container.textContent).toBe("");
  });
});
