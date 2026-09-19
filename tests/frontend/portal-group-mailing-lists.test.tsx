// @vitest-environment jsdom
import { exampleMembershipCategories } from "./helpers/membership-category-catalog";
vi.mock("../../assets/ts/hooks/useMembershipCategoryCatalog", () => ({
  useMembershipCategoryCatalog: () => exampleMembershipCategories,
}));
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { beginRecordEdit } from "./helpers/record-edit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupMailingLists } from "../../assets/ts/member-flows/portal/sections/management/GroupMailingLists";
import {
  groupMailingListCreateSchema,
  mailingListLifecycleTransitionSchema,
} from "../../assets/shared/schemas/mailing-lists";
import { chooseColumnFilter, columnFilterSummary } from "./helpers/column-menu";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

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

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
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

describe("portal group mailing lists", () => {
  it("shows the manager collection with server-side query parameters and no participant controls for staff-only managers", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname.endsWith("/synchronization")) return json({ synchronization: { enabled: true, revision: 0 } });
        return json({
          mailingLists: [
            {
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
              active: true,
              archivedAt: null,
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );

    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} />);
    // While the page loads the table stays mounted and announces itself busy
    // over skeleton rows, instead of collapsing to a spinner.
    expect(container.querySelector('table[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector(".pk-table__skeleton")).not.toBeNull();
    await settle();
    expect(container.querySelector('table[aria-busy="true"]')).toBeNull();

    expect(container.textContent).toContain("Managed mailing lists");
    expect(container.textContent).toContain("Architecture discussion");
    expect(container.textContent).not.toContain("My mailing-list preferences");
    expect(container.querySelector('select[aria-label^="Subscription preference"]')).toBeNull();
    const collectionRequests = requests.filter((url) => url.pathname.endsWith("/management"));
    expect(collectionRequests).toHaveLength(1);
    expect(collectionRequests[0]).toMatchObject({
      pathname: `/api/v1/groups/${GROUP_ID}/mailing-lists/management`,
    });
    expect(collectionRequests[0].searchParams.get("limit")).toBe("50");
    expect(collectionRequests[0].searchParams.get("sort")).toBe("label");
    expect(container.textContent).not.toContain("Enable Google Groups synchronization");
  });
  it("renders the manager empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/synchronization")
          ? json({ synchronization: { enabled: true, revision: 0 } })
          : json({ mailingLists: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }),
      ),
    );
    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage />);
    await settle();
    expect(container.textContent).toContain("No mailing lists yet");
    expect(container.textContent).toContain("Add mailing list");
  });
  it("narrows to the primary discussion list from the Role column and sends the choice to the management query", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input), location.origin));
        if (String(input).endsWith("/synchronization"))
          return json({ synchronization: { enabled: true, revision: 0 } });
        return json({ mailingLists: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} />);
    await settle();

    // No select above the table: the filter lives in the menu of the column
    // that shows which list is the group's primary discussion list.
    expect(container.querySelector('[role="toolbar"] select')).toBeNull();
    // The default view is the server default: no `primaryDiscussion` parameter at all.
    expect(requests.some((url) => url.searchParams.has("primaryDiscussion"))).toBe(false);

    await chooseColumnFilter(container, "Role", "Primary discussion list");
    await settle();

    expect(requests.at(-1)?.searchParams.get("primaryDiscussion")).toBe("true");
    // And the page went back to the start of the narrowed list.
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(columnFilterSummary(container, "Role")).toBe("Primary discussion list");
  });
  it("renders manager collection errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Not allowed" }), { status: 403 })),
    );
    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage />);
    await settle();
    expect(container.textContent).toContain("don't have access");
  });
  it("creates, edits, and archives a fully configured group list without moving ownership", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    const list = {
      id: "a0000000-0000-4000-8000-000000000001",
      email: "architecture@lists.example.test",
      label: "Architecture discussion",
      purpose: "group",
      groupId: GROUP_ID,
      primaryDiscussion: true,
      subscriptionDefault: "group_members",
      postingPolicy: "members",
      moderationPolicy: "moderated",
      autoSyncCategories: ["A"],
      active: true,
      archivedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    } as const;
    const page = { limit: 50, offset: 0, total: 1, hasMore: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body });
        if (url.pathname.endsWith("/synchronization")) return json({ synchronization: { enabled: true, revision: 0 } });
        if (method === "POST") return json({ mailingList: list });
        if (method === "PATCH") return json({ mailingList: list });
        if (method === "DELETE") return json({ success: true });
        if (url.pathname.endsWith("/grants")) return json({ grants: [], page });
        if (url.pathname.endsWith("/subscribers")) return json({ subscribers: [], page: { ...page, total: 0 } });
        if (url.pathname.endsWith(`/mailing-lists/${list.id}`)) return json({ mailingList: list });
        if (url.pathname === "/api/v1/groups") {
          return json({ groups: [], page });
        }
        return json({ mailingLists: [list], page });
      }),
    );

    const listing = mount(
      <>
        <GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();
    // Nothing is layered over the list to begin with: creating is a place
    // with its own address, under the reserved `new` segment.
    expect(listing.querySelector('input[type="email"]')).toBeNull();

    const container = mount(
      <>
        <GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} listSegment="new" />
        <ConfirmDialogHost />
      </>,
    );
    await settle();
    const createForm = container.querySelector("form")!;
    const email = createForm.querySelector<HTMLInputElement>('input[type="email"]')!;
    const textInputs = createForm.querySelectorAll<HTMLInputElement>(
      'input:not([type="email"]):not([type="checkbox"]):not([readonly])',
    );
    email.value = "consultation@lists.example.test";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    textInputs[0].value = "Consultation list";
    textInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    const selects = createForm.querySelectorAll<HTMLSelectElement>("select");
    selects[0].value = "consultation";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    selects[1].value = "eligible_categories";
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));
    selects[2].value = "members";
    selects[2].dispatchEvent(new Event("change", { bubbles: true }));
    selects[3].value = "moderated";
    selects[3].dispatchEvent(new Event("change", { bubbles: true }));
    const categoryA = createForm.querySelector<HTMLInputElement>("#group-mailing-list-create-auto-sync-categories-A")!;
    categoryA.checked = true;
    await act(async () => {
      categoryA.dispatchEvent(new Event("input", { bubbles: true }));
      categoryA.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const categoryH1 = createForm.querySelector<HTMLInputElement>(
      "#group-mailing-list-create-auto-sync-categories-H1",
    )!;
    categoryH1.checked = true;
    await act(async () => {
      categoryH1.dispatchEvent(new Event("input", { bubbles: true }));
      categoryH1.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await act(async () => {
      createForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await settle();

    const created = requests.find(({ method }) => method === "POST");
    expect(created).toMatchObject({
      url: expect.objectContaining({ pathname: `/api/v1/groups/${GROUP_ID}/mailing-lists` }),
    });
    expect(groupMailingListCreateSchema.parse(created?.body)).toMatchObject({
      email: "consultation@lists.example.test",
      label: "Consultation list",
      purpose: "consultation",
      subscriptionDefault: "eligible_categories",
      postingPolicy: "members",
      moderationPolicy: "moderated",
      autoSyncCategories: ["A", "H1"],
    });
    expect(created?.body).not.toHaveProperty("groupId");

    /*
     * Editing happens on the list's own record, which the table addresses
     * rather than unfolds — so the edit is asserted on the record mount, and
     * the row's own commands back on the listing.
     */
    const record = mount(
      <>
        <GroupMailingLists
          groupId={GROUP_ID}
          canManage
          canParticipate={false}
          listSegment={list.id}
          listTab="settings"
        />
        <ConfirmDialogHost />
      </>,
    );
    await settle();
    await settle();
    // The record stands alone: a manager reading one list is not also shown
    // their own preferences for every other list.
    expect(record.textContent).not.toContain("My mailing-list preferences");
    expect(record.querySelector('input[name="label"]')).toBeNull();
    await beginRecordEdit(record, "Delivery actions", "Edit");
    await settle();
    const saveButton = Array.from(record.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Save changes",
    );
    expect(saveButton).not.toBeUndefined();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    const edited = requests.find(({ method }) => method === "PATCH");
    expect(edited?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/mailing-lists/${list.id}`);
    expect(edited?.body).not.toHaveProperty("groupId");

    await settle();
    // The row's commands live behind its menu, whose trigger names the list.
    expect(rowActionControlNames(listing)).toEqual(["Actions for Architecture discussion"]);
    await runRowAction(listing, "Architecture discussion", "Archive");
    await settle();
    const archiveDialog = listing.querySelector('[role="alertdialog"]');
    expect(archiveDialog).not.toBeNull();
    await act(async () => {
      Array.from(archiveDialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent === "Archive mailing list")
        ?.click();
    });
    await settle();
    // Archiving is a state transition, not a deletion: the row's command
    // sends the shared transition contract to the list's own endpoint.
    const archived = requests.find(({ url }) => url.pathname.endsWith("/transitions"));
    expect(archived?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/mailing-lists/${list.id}/transitions`);
    expect(mailingListLifecycleTransitionSchema.parse(archived?.body)).toEqual({ transition: "archive" });
    expect(requests.some(({ method }) => method === "DELETE")).toBe(false);
  });
});
