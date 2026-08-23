// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../assets/ts/admin/api";
import { UserPicker } from "../../assets/ts/admin/sections/access-control/UserPicker";
import type { AdminUser } from "../../assets/ts/admin/types";

vi.mock("../../assets/ts/admin/api", () => ({ api: vi.fn() }));

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

function user(id: string, email: string): AdminUser {
  return {
    id,
    email,
    first_name: null,
    last_name: null,
    organization_name: null,
    role: "user",
    active: 1,
    created_at: "2026-01-01T00:00:00Z",
    member_id: null,
    member_category: null,
    member_status: null,
    member_organization_id: null,
    member_organization_name: null,
    links: [],
    membership: null,
    type: "contact_only",
    eventParticipationCount: 0,
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

  async function mountPicker() {
    const container = document.createElement("div");
    mounted.push(container);
    await act(() => render(h(UserPicker, { value: null, onChange: vi.fn() }), container));
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
    const oldRequest = deferred<{ users: AdminUser[] }>();
    const newRequest = deferred<{ users: AdminUser[] }>();
    vi.mocked(api)
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

  it("does not clear a newer result when an older search fails", async () => {
    vi.useFakeTimers();
    const oldRequest = deferred<{ users: AdminUser[] }>();
    const newRequest = deferred<{ users: AdminUser[] }>();
    vi.mocked(api)
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

  it("aborts an in-flight search when unmounted", async () => {
    vi.useFakeTimers();
    const request = deferred<{ users: AdminUser[] }>();
    vi.mocked(api).mockImplementationOnce((_path, _schema, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return request.promise;
    });
    const { container, input } = await mountPicker();
    await search(input, "old");
    const signal = vi.mocked(api).mock.calls[0][2]?.signal;

    await act(() => render(null, container));
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      request.resolve({ users: [user("old-id", "old@example.test")] });
      await flush();
    });
    expect(container.textContent).toBe("");
  });
});
