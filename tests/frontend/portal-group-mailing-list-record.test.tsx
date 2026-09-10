// @vitest-environment jsdom
/**
 * A mailing list's own page.
 *
 * What is asserted here is what the page promises a reader: an address per
 * tab, the people on the list answered by the server rather than narrowed
 * here, and the two lifecycle commands — the reversible one and the
 * irreversible one — asking before they act and sending the shared contract.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mailingListLifecycleTransitionSchema, type MailingList } from "../../assets/shared/schemas/mailing-lists";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";

const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

import { GroupMailingListRecord } from "../../assets/ts/member-flows/portal/sections/management/GroupMailingListRecord";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const LIST_ID = "a0000000-0000-4000-8000-000000000001";
const PAGE = { limit: 50, offset: 0, total: 1, hasMore: false };

const activeList: MailingList = {
  id: LIST_ID,
  email: "architecture@lists.example.test",
  label: "Architecture discussion",
  purpose: "group",
  groupId: GROUP_ID,
  primaryDiscussion: true,
  subscriptionDefault: "group_members",
  postingPolicy: "members",
  moderationPolicy: "moderated",
  autoSyncCategories: null,
  active: true,
  archivedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const subscriber = {
  user: {
    id: "b0000000-0000-4000-8000-000000000001",
    email: "ada@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    organization_name: "Analytical Engines",
  },
  eligible: true,
  defaultSubscribed: true,
  preference: null,
  subscribed: true,
};

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

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

/** Answers the record and the roster; `write` answers everything else. */
function stubApi(
  list: MailingList,
  write: (url: URL, method: string) => Response = () => json({ mailingList: list }),
): Array<{ url: URL; method: string; body?: unknown }> {
  const calls: Array<{ url: URL; method: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, location.origin);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "GET" && url.pathname.endsWith("/subscribers")) {
        return json({ subscribers: [subscriber], page: PAGE });
      }
      if (method === "GET" && url.pathname.endsWith("/grants")) return json({ grants: [], page: PAGE });
      if (method === "GET" && url.pathname === "/api/v1/groups") return json({ groups: [], page: PAGE });
      if (method === "GET") return json({ mailingList: list });
      return write(url, method);
    }),
  );
  return calls;
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const control = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (!control) throw new Error(`No control named ${name}`);
  return control;
}

async function runCommand(container: HTMLElement, label: string): Promise<void> {
  await act(() => {
    buttonNamed(container, `Mailing list actions for ${activeList.label}`).click();
  });
  await settle();
  await act(() => {
    const item = [...container.querySelectorAll('[role="menuitem"]')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!item) throw new Error(`No command named ${label}`);
    (item as HTMLElement).click();
  });
  await settle();
}

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group mailing-list record", () => {
  it("opens on the subscribers, and gives every tab its own address", async () => {
    stubApi(activeList);
    const container = mount(<GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} onLeave={() => {}} />);
    // Twice: the record loads first, and the roster it opens on follows it.
    await settle();
    await settle();

    // The record names itself and states whether it is in service.
    expect(container.querySelector(".pk-profile-header__title")?.textContent).toBe(activeList.label);
    expect(container.textContent).toContain("Active");

    // Each tab is a place: a link whose href is the tab's own URL, so it can
    // be copied, opened in a new tab, and returned to with the back button.
    const tabs = [...container.querySelectorAll<HTMLAnchorElement>("nav a")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Subscribers", "Settings", "Sharing"]);
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      `#/groups/${GROUP_ID}/mailing-lists/${LIST_ID}`,
      `#/groups/${GROUP_ID}/mailing-lists/${LIST_ID}/settings`,
      `#/groups/${GROUP_ID}/mailing-lists/${LIST_ID}/sharing`,
    ]);
    expect(tabs[0]?.getAttribute("aria-current")).toBe("page");

    // Without a tab segment the page opens on the people the list reaches.
    expect(container.querySelector('section[aria-label="Architecture discussion subscribers"]')).not.toBeNull();
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Subscribed");

    // Choosing a tab navigates rather than swapping a panel in place.
    await act(() => {
      tabs[1]?.click();
    });
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/mailing-lists/${LIST_ID}/settings`);
  });

  it("saves sections independently and preserves another section's unsaved draft", async () => {
    const calls = stubApi(activeList);
    const container = mount(
      <GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} initialTab="settings" onLeave={() => {}} />,
    );
    await settle();
    const delivery = container.querySelector('section[aria-label="Delivery"]')!;
    const audience = container.querySelector('section[aria-label="Audience"]')!;
    await act(() => {
      buttonNamed(delivery, "Edit").click();
      buttonNamed(audience, "Edit").click();
    });
    await act(() => {
      const label = delivery.querySelector<HTMLInputElement>('input[name="label"]')!;
      label.value = "Unsaved delivery name";
      label.dispatchEvent(new Event("input", { bubbles: true }));
      const select = audience.querySelector<HTMLSelectElement>('select[name="subscriptionDefault"]')!;
      select.value = "none";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => buttonNamed(audience, "Save changes").click());
    await settle();
    await settle();
    expect(calls.filter((call) => call.method === "PATCH").map((call) => call.body)).toEqual([
      { purpose: "group", subscriptionDefault: "none", autoSyncCategories: null },
    ]);
    expect(delivery.querySelector<HTMLInputElement>('input[name="label"]')?.value).toBe("Unsaved delivery name");
    await act(() => buttonNamed(delivery, "Save changes").click());
    await settle();
    expect(calls.filter((call) => call.method === "PATCH").at(-1)?.body).toEqual({
      email: activeList.email,
      label: "Unsaved delivery name",
      postingPolicy: "members",
      moderationPolicy: "moderated",
    });
  });

  it("opens the tab the URL names, and asks the server for the roster it shows", async () => {
    const calls = stubApi(activeList);
    const container = mount(
      <GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} initialTab="settings" onLeave={() => {}} />,
    );
    await settle();

    expect(container.querySelector('section[aria-label="Architecture discussion settings"]')).not.toBeNull();
    expect(container.querySelector("form")).not.toBeNull();
    // The settings tab opens on the record's own values.
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.textContent).toContain(activeList.email);
    expect(container.querySelector('button[type="submit"]')).toBeNull();

    // An unrecognized segment falls back to the default rather than showing
    // an empty page.
    const fallback = mount(
      <GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} initialTab="nonsense" onLeave={() => {}} />,
    );
    await settle();
    expect(fallback.querySelector('section[aria-label="Architecture discussion subscribers"]')).not.toBeNull();

    // The roster is a server query: paging, sorting, and searching are its
    // parameters, not a filter applied to a fetched dataset.
    const roster = calls.find(({ url }) => url.pathname.endsWith("/subscribers"));
    expect(roster?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/mailing-lists/${LIST_ID}/subscribers`);
    expect(roster?.url.searchParams.get("limit")).toBe("50");
    expect(roster?.url.searchParams.get("sort")).toBe("email");
  });

  it("archives through the shared transition contract after confirming", async () => {
    const calls = stubApi(activeList);
    const container = mount(
      <>
        <GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} onLeave={() => {}} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();

    await runCommand(container, "Archive");
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain(activeList.label);
    expect(dialog?.textContent).toContain("Its configuration, its subscribers, and its history are kept");
    await act(() => {
      buttonNamed(dialog as ParentNode, "Archive mailing list").click();
    });
    await settle();

    const transition = calls.find(({ method }) => method === "POST");
    expect(transition?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/mailing-lists/${LIST_ID}/transitions`);
    // Parsed through the shared request schema rather than compared literally.
    expect(mailingListLifecycleTransitionSchema.parse(transition?.body)).toEqual({ transition: "archive" });
  });

  it("offers restore instead of archive once a list is archived", async () => {
    const archived: MailingList = { ...activeList, active: false, archivedAt: "2026-08-02T00:00:00.000Z" };
    const calls = stubApi(archived);
    const container = mount(
      <>
        <GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} onLeave={() => {}} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();
    expect(container.textContent).toContain("Archived");

    await runCommand(container, "Restore");
    await act(() => {
      buttonNamed(container.querySelector("dialog") as ParentNode, "Restore mailing list").click();
    });
    await settle();

    expect(mailingListLifecycleTransitionSchema.parse(calls.find(({ method }) => method === "POST")?.body)).toEqual({
      transition: "restore",
    });
  });

  it("makes deleting cost the list's address, and leaves the record when it is gone", async () => {
    const leave = vi.fn();
    const calls = stubApi(activeList, () => json({ success: true }));
    const container = mount(
      <>
        <GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} onLeave={leave} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();

    await runCommand(container, "Delete");
    const dialog = container.querySelector('[role="alertdialog"]')!;
    const confirm = buttonNamed(dialog, "Delete mailing list");
    // Irreversible: until the address is typed back, the button refuses.
    expect(confirm.disabled).toBe(true);
    const phrase = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(() => {
      phrase.value = activeList.email;
      phrase.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      buttonNamed(container.querySelector("dialog") as ParentNode, "Delete mailing list").click();
    });
    await settle();

    expect(calls.find(({ method }) => method === "DELETE")?.url.pathname).toBe(
      `/api/v1/groups/${GROUP_ID}/mailing-lists/${LIST_ID}`,
    );
    expect(leave).toHaveBeenCalled();
  });

  it("announces a refused delete instead of pretending the list is gone", async () => {
    const leave = vi.fn();
    stubApi(activeList, () =>
      json({ error: { code: "MAILING_LIST_HAS_SUBSCRIPTION_HISTORY", message: "Archive it instead" } }, 409),
    );
    const container = mount(
      <>
        <GroupMailingListRecord groupId={GROUP_ID} listId={LIST_ID} onLeave={leave} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();

    await runCommand(container, "Delete");
    const dialog = container.querySelector('[role="alertdialog"]')!;
    const phrase = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(() => {
      phrase.value = activeList.email;
      phrase.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      buttonNamed(container.querySelector("dialog") as ParentNode, "Delete mailing list").click();
    });
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Archive it instead");
    expect(leave).not.toHaveBeenCalled();
    expect(container.querySelector(".pk-profile-header__title")?.textContent).toBe(activeList.label);
  });
});
