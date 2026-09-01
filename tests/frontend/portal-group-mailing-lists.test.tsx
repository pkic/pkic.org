// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupMailingLists } from "../../assets/ts/member-flows/portal/sections/management/GroupMailingLists";
import { groupMailingListCreateSchema } from "../../assets/shared/schemas/mailing-lists";
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
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await settle();

    expect(container.textContent).toContain("Managed mailing lists");
    expect(container.textContent).toContain("Architecture discussion");
    expect(container.textContent).not.toContain("My mailing-list preferences");
    expect(container.querySelector('select[aria-label^="Subscription preference"]')).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      pathname: `/api/v1/groups/${GROUP_ID}/mailing-lists/management`,
    });
    expect(requests[0].searchParams.get("limit")).toBe("50");
    expect(requests[0].searchParams.get("sort")).toBe("label");
  });
  it("renders the manager empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ mailingLists: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage />);
    await settle();
    expect(container.textContent).toContain("No mailing lists yet");
    expect(container.textContent).toContain("Add mailing list");
  });
  it("names the primary-discussion filter and sends the choice to the management query", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input), location.origin));
        return json({ mailingLists: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const container = mount(<GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} />);
    await settle();

    const filter = container.querySelector<HTMLSelectElement>('select[aria-label="Primary discussion list"]')!;
    expect(filter).not.toBeNull();
    // The default view is the server default: no `primaryDiscussion` parameter at all.
    expect(requests.some((url) => url.searchParams.has("primaryDiscussion"))).toBe(false);

    filter.value = "true";
    await act(async () => {
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(requests.some((url) => url.searchParams.get("primaryDiscussion") === "true")).toBe(true);
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
        if (method === "POST") return json({ mailingList: list });
        if (method === "PATCH") return json({ mailingList: list });
        if (method === "DELETE") return json({ success: true });
        if (url.pathname.endsWith("/grants")) return json({ grants: [], page });
        if (url.pathname === "/api/v1/groups") {
          return json({ groups: [], page });
        }
        return json({ mailingLists: [list], page });
      }),
    );

    const container = mount(
      <>
        <GroupMailingLists groupId={GROUP_ID} canManage canParticipate={false} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();
    const button = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
    expect(container.querySelector("form")).toBeNull();
    await act(async () => {
      button("Add mailing list")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

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
      categoryA.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const categoryH1 = createForm.querySelector<HTMLInputElement>(
      "#group-mailing-list-create-auto-sync-categories-H1",
    )!;
    categoryH1.checked = true;
    await act(async () => {
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

    // The row itself opens the editor; its activation names the list.
    expect(button("Manage Architecture discussion")).not.toBeUndefined();
    await act(async () => {
      button("Manage Architecture discussion")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    const saveButton = button("Save changes");
    expect(saveButton).not.toBeUndefined();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(requests.find(({ method }) => method === "PATCH")?.body).not.toHaveProperty("groupId");

    await settle();
    // The row's remaining command lives behind its menu, whose trigger
    // names the list.
    expect(rowActionControlNames(container)).toEqual(["Actions for Architecture discussion"]);
    await runRowAction(container, "Architecture discussion", "Archive");
    await settle();
    const archiveDialog = container.querySelector('[role="alertdialog"]');
    expect(archiveDialog).not.toBeNull();
    await act(async () => {
      Array.from(archiveDialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent === "Archive mailing list")
        ?.click();
    });
    await settle();
    expect(requests.some(({ method }) => method === "DELETE")).toBe(true);
  });
});
