// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserPicker, type PickedUser } from "../../assets/ts/components/UserPicker";
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

/*
 * One mount/teardown/search scaffold for the whole file. Each describe used to
 * carry its own copy, which is how a third arrived with the geometry tests.
 */
const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Mounted into the document, because some of these assertions are about geometry. */
async function mountPicker({
  endpoint,
  onChange = vi.fn(),
}: { endpoint?: string; onChange?: (picked: PickedUser | null) => void } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => render(h(UserPicker, { value: null, onChange, endpoint }), container));
  return { container, input: container.querySelector("input") as HTMLInputElement };
}

/** Types a term and lets the picker's debounce elapse. Requires fake timers. */
async function search(input: HTMLInputElement, value: string) {
  input.value = value;
  await act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

function popupOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".pk-menu__popup");
}

describe("UserPicker request ordering", () => {
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
    const scoped = await mountPicker({ endpoint: "/api/v1/groups/group%2Fone/users" });
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
    // A failed search leaves nothing to choose from, so nothing may be left
    // behind announcing that there is.
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("names the field, names its suggestion list, and announces that suggestions arrived", async () => {
    vi.useFakeTimers();
    vi.mocked(getJson).mockResolvedValue({ users: [user("ada-id", "ada@example.test")] });
    const { container, input } = await mountPicker();

    // Every call site puts a heading beside this control, but none of them
    // owns its id, so without a name of its own the field was announced as an
    // unlabelled text box.
    expect(input.getAttribute("aria-label")).toBe("Search for a user");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");

    await search(input, "ada");
    await act(async () => {
      await flush();
    });

    // Suggestions appear without the reader asking for them, so their arrival
    // is announced rather than left to be discovered.
    expect(container.querySelector('[role="status"]')?.textContent).toBe("1 matching user");
    // A bare `aria-label` on a `<div>` is discarded; the role is what gives
    // the name somewhere to land.
    const suggestions = container.querySelector('[role="group"]');
    expect(suggestions?.getAttribute("aria-label")).toBe("Matching users");
    // Each match stays a real control, so it is reachable without a pointer.
    expect(suggestions?.querySelectorAll("button")).toHaveLength(1);
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

describe("UserPicker response contract", () => {
  it("accepts the staff users list, which carries no organization name, as well as the catalog", async () => {
    vi.useFakeTimers();
    vi.mocked(getJson).mockResolvedValue({ users: [], page: { limit: 8, offset: 0, total: 0, hasMore: false } });
    const { input } = await mountPicker();
    await search(input, "admin@");

    // The default endpoint is the staff users list, and the schema the picker
    // hands to the client must accept what that list answers with: id, email
    // and names, no organization. Parsing with the catalog's full contract
    // refused every reply and reported "Could not search users."
    const [url, schema] = vi.mocked(getJson).mock.calls[0];
    expect(url).toContain("/api/v1/users?");
    const usersListReply = {
      users: [
        { id: "00000000-0000-4000-8000-000000000001", email: "admin@pkic.org", first_name: "PKIC", last_name: "Admin" },
      ],
      page: { limit: 8, offset: 0, total: 1, hasMore: false },
    };
    expect(schema.safeParse(usersListReply).success).toBe(true);
    const catalogReply = {
      users: [{ ...usersListReply.users[0], organization_name: "PKI Consortium" }],
      page: usersListReply.page,
    };
    expect(schema.safeParse(catalogReply).success).toBe(true);
  });
});

/**
 * Two pickers on one page.
 *
 * The Leadership page mounts one roster per body — Board of Directors and
 * Executive Council — and each roster's add form carries its own picker, so
 * two are always live at once. Picking in the lower one used to be
 * impossible: not because the instances shared anything, but because the
 * popup was pinned to `anchor.bottom + 4` with no flip and no clamp, so a
 * field below the fold hung its matches under the bottom edge of the
 * viewport, where they render and can never be clicked.
 */
describe("UserPicker instances on one page", () => {
  it("keeps a lower picker's matches inside the viewport instead of below it", async () => {
    vi.useFakeTimers();
    vi.mocked(getJson).mockResolvedValue({ users: [user("ada-id", "ada@example.test")] });

    // jsdom reports a zero-sized layout, so the geometry that decides the
    // placement is supplied here: a field near the bottom of a 768px viewport
    // — where the second of two rosters sits once the page is scrolled to it
    // — and a popup too tall to fit beneath it.
    const popupHeight = 200;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const popup = this.classList.contains("pk-menu__popup");
      const box = popup
        ? { top: 0, left: 0, width: 300, height: popupHeight }
        : { top: 700, left: 100, width: 300, height: 36 };
      return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top } as DOMRect;
    });

    const { container, input } = await mountPicker();
    await search(input, "ada");
    await act(async () => {
      await flush();
    });

    const popup = popupOf(container);
    expect(popup).not.toBeNull();
    const top = Number.parseFloat(popup!.style.top);
    // The whole popup is reachable: it flipped above the field rather than
    // hanging off the bottom, and it never starts above the viewport either.
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + popupHeight).toBeLessThanOrEqual(window.innerHeight);
    // It is still anchored to this field, not to some other instance's.
    expect(popup!.style.minWidth).toBe("300px");
  });

  it("searches and picks in the second picker without disturbing the first", async () => {
    vi.useFakeTimers();
    vi.mocked(getJson).mockImplementation((url) => {
      const term = new URL(String(url), "https://app.test").searchParams.get("q");
      return Promise.resolve({
        users:
          term === "board" ? [user("board-id", "board@example.test")] : [user("council-id", "council@example.test")],
      });
    });

    const onFirstChange = vi.fn();
    const onSecondChange = vi.fn();
    const first = await mountPicker({ onChange: onFirstChange });
    const second = await mountPicker({ onChange: onSecondChange });

    await search(first.input, "board");
    await search(second.input, "council");
    await act(async () => {
      await flush();
    });

    // Each instance holds its own matches; neither took the other's results.
    expect(popupOf(first.container)?.textContent).toContain("board@example.test");
    expect(popupOf(second.container)?.textContent).toContain("council@example.test");

    const match = popupOf(second.container)?.querySelector("button") as HTMLButtonElement;
    await act(() => {
      match.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSecondChange).toHaveBeenCalledWith({ id: "council-id", email: "council@example.test" });
    // The pick closed the second picker's popup and filled its own input …
    expect(popupOf(second.container)).toBeNull();
    expect(second.input.value).toBe("council@example.test");
    // … and left the first picker exactly as it was.
    expect(onFirstChange).not.toHaveBeenCalled();
    expect(popupOf(first.container)?.textContent).toContain("board@example.test");
    expect(first.input.value).toBe("board");
  });
});
