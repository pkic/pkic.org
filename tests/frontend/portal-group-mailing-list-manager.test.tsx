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

/*
 * The surface addresses its own create page, so it reads the portal's location
 * hook. The hook is wouter's, which is React's under preact/compat and has no
 * dispatcher in a bare mount — the same mock every other surface test that
 * navigates uses.
 */
const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));
import { buttonNamed, controlFor, submitForm, typeInto } from "./helpers/labelled-control";
import { rowActionControlNames, rowMenuTrigger } from "./helpers/row-actions";

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
      if (url.pathname.endsWith("/synchronization")) return json({ synchronization: { enabled: true, revision: 0 } });
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
    const region = container.querySelector<HTMLElement>('section[aria-label="Managed mailing lists"]');
    expect(region).not.toBeNull();

    // A page with several tables announces several tables unless each is named.
    expect(container.querySelector("table caption")?.textContent).toBe("Managed mailing lists");

    // Status is a word, not a tone: the badge reads "Archived" to someone who
    // cannot separate the hues, and the dot repeats it as a shape.
    const status = container.querySelector(".pk-badge");
    expect(status?.textContent).toBe("Archived");
    expect(status?.className).toContain("pk-badge--dot");
  });

  it("puts the create form on its own page and wires its labels to its controls", async () => {
    stubApi([archivedList]);
    // Nothing is layered over the list to begin with.
    const list = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();
    expect(list.querySelector('input[type="email"]')).toBeNull();

    // Creating is a place with its own address, reached under the reserved
    // `new` segment rather than by unfolding a panel above the table.
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} listSegment="new" />);
    await settle();
    expect(container.querySelector("table")).toBeNull();

    const form = container.querySelector("form")!;
    expect(form.textContent).toContain("New group mailing list");
    // Resolving each control through its own `for`/`id` pair, so the lookup
    // fails exactly when the labelling breaks.
    expect(controlFor(form, "Email").type).toBe("email");
    expect(controlFor(form, "Label").required).toBe(true);
    /*
     * Ownership is stated rather than offered. It was a text input carrying
     * `readOnly`, which reads as a field a reader may type in and cannot —
     * part of what #50 called a messy page.
     */
    expect(form.querySelector("input[readonly]")).toBeNull();
    expect(form.textContent).toContain("Owned by this group");
  });

  it("posts the shared create contract and derives ownership from the route", async () => {
    const calls = stubApi([archivedList]);
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} listSegment="new" />);
    await settle();

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
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} listSegment="new" />);
    await settle();

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

  it("opens a list's own page from its row instead of unfolding it in the table", async () => {
    stubApi([archivedList]);
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();

    // Activating the row navigates: a list is a record with an address, so
    // nothing unfolds between the table's rows.
    await act(() => {
      buttonNamed(container, "Open Architecture discussion").click();
    });
    await settle();

    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/mailing-lists/${archivedList.id}`);
    expect(container.querySelector(".pk-table__detail")).toBeNull();
    expect(container.querySelector('input[type="email"]')).toBeNull();
  });

  it("offers restore rather than archive on an archived list, and always offers delete", async () => {
    stubApi([archivedList]);
    const container = mount(<GroupMailingListManager groupId={GROUP_ID} />);
    await settle();

    // The command that does not apply is absent rather than shown disabled:
    // the list is out of service, so the move it offers is back into service.
    expect(rowActionControlNames(container)).toEqual(["Actions for Architecture discussion"]);
    await act(() => {
      rowMenuTrigger(container, archivedList.label)?.click();
    });
    await settle();
    expect([...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toEqual([
      "Sync now",
      "Restore",
      "Delete",
    ]);
  });
});
