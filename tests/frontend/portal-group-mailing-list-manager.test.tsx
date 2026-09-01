// @vitest-environment jsdom
/**
 * The group mailing-list management surface, after its move onto the design
 * system.
 *
 * What is asserted here is deliberately not "which classes are on which div":
 * it is what the surface promises a reader who cannot see it — the region's
 * name, the table's caption, a status stated in words rather than a colour,
 * the label/control pairs of the revealed form — plus the path where the
 * server refuses the write.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupMailingListCreateSchema, type MailingList } from "../../assets/shared/schemas/mailing-lists";
import { GroupMailingListManager } from "../../assets/ts/member-flows/portal/sections/management/GroupMailingListManager";
import { buttonNamed, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const PAGE = { limit: 50, offset: 0, total: 1, hasMore: false };

const archivedList: MailingList = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "architecture@lists.example.test",
  label: "Architecture discussion",
  purpose: "group",
  groupId: GROUP_ID,
  primaryDiscussion: true,
  subscriptionDefault: "group_members",
  postingPolicy: "members",
  moderationPolicy: "moderated",
  autoSyncCategories: null,
  active: false,
  archivedAt: "2026-08-02T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
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

/** Records every call and answers the list endpoint; `write` answers the rest. */
function stubApi(
  lists: MailingList[],
  write: (url: URL, method: string) => Response = () => json({ mailingList: archivedList }),
): Array<{ url: URL; method: string; body?: unknown }> {
  const calls: Array<{ url: URL; method: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, location.origin);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "GET") return json({ mailingLists: lists, page: { ...PAGE, total: lists.length } });
      return write(url, method);
    }),
  );
  return calls;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group mailing-list management surface", () => {
  it("names its region and its table, and states an archived list in words", async () => {
    stubApi([archivedList]);
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();

    // The region a screen reader lands in, found by the name it announces —
    // the same name the end-to-end spec navigates by.
    const region = container.querySelector<HTMLElement>('section[aria-label="Mailing-list management"]');
    expect(region).not.toBeNull();

    // A page with several tables announces several tables unless each is named.
    expect(container.querySelector("table caption")?.textContent).toBe("Managed mailing lists");

    // Status is a word, not a tone: the badge reads "Archived" to someone who
    // cannot separate the hues, and the dot repeats it as a shape.
    const status = container.querySelector(".pk-badge");
    expect(status?.textContent).toBe("Archived");
    expect(status?.className).toContain("pk-badge--dot");
  });

  it("keeps the create form behind the toolbar's action and wires its labels to its controls", async () => {
    stubApi([archivedList]);
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();

    expect(container.querySelector("form")).toBeNull();
    await act(() => {
      buttonNamed(container, "Add mailing list").click();
    });

    const form = container.querySelector("form")!;
    expect(form.textContent).toContain("New group mailing list");
    // Resolving each control through its own `for`/`id` pair, so the lookup
    // fails exactly when the labelling breaks.
    expect(controlFor(form, "Email").type).toBe("email");
    expect(controlFor(form, "Label").required).toBe(true);
    expect(controlFor(form, "Ownership").value).toBe("This group");
    expect(controlFor(form, "Ownership").readOnly).toBe(true);
  });

  it("posts the shared create contract and derives ownership from the route", async () => {
    const calls = stubApi([archivedList]);
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();
    await act(() => {
      buttonNamed(container, "Add mailing list").click();
    });

    const form = container.querySelector("form")!;
    await typeInto(controlFor(form, "Email"), "consultation@lists.example.test");
    await typeInto(controlFor(form, "Label"), "Consultation list");
    await submitForm(container);
    await settle();

    const created = calls.find(({ method }) => method === "POST");
    expect(created?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/mailing-lists`);
    // Parsed through the shared request schema rather than compared literally,
    // so the assertion moves when the contract does.
    expect(groupMailingListCreateSchema.parse(created?.body)).toMatchObject({
      email: "consultation@lists.example.test",
      label: "Consultation list",
    });
    expect(created?.body).not.toHaveProperty("groupId");
  });

  it("announces a refused create through an alert and leaves the form open to correct", async () => {
    stubApi([archivedList], () => json({ message: "Conflict" }, 409));
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();
    await act(() => {
      buttonNamed(container, "Add mailing list").click();
    });

    const form = container.querySelector("form")!;
    await typeInto(controlFor(form, "Email"), "consultation@lists.example.test");
    await typeInto(controlFor(form, "Label"), "Consultation list");
    await submitForm(container);
    await settle();

    // An error the reader has to act on interrupts rather than waits.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Someone else changed this at the same time");
    // The draft survives the failure, so the correction is one edit away.
    expect(container.querySelector("form")).not.toBeNull();
    expect(controlFor(container.querySelector("form")!, "Label").value).toBe("Consultation list");
  });

  it("opens one row's editor as a named detail region and reports it as expanded", async () => {
    stubApi([archivedList], () => json({ grants: [], page: PAGE }));
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();

    const manage = buttonNamed(container, "Manage");
    expect(manage.getAttribute("aria-expanded")).toBe("false");
    await act(() => {
      manage.click();
    });
    await settle();

    expect(buttonNamed(container, "Close").getAttribute("aria-expanded")).toBe("true");
    const detail = container.querySelector(".pk-table__detail");
    expect(detail?.textContent).toContain(`Manage ${archivedList.label}`);
    // The editor opens on the row's own values rather than a blank draft.
    expect(controlFor(detail!, "Email").value).toBe(archivedList.email);
  });
});
