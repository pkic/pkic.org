import type { GroupEvent } from "../../assets/shared/schemas/group-events";
// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_INVITE_STATUSES } from "../../assets/shared/schemas/event-invites";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupEventInvitations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventInvitations";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
import { chooseColumnFilter, columnFilterOptions, columnFilterSummary } from "./helpers/column-menu";
import { controlFor } from "./helpers/labelled-control";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const mounted: HTMLElement[] = [];
import {
  GROUP_ID,
  EVENT_ID,
  INVITE_ID,
  EVENT,
  json,
  response,
  invite,
  speakerInvite,
} from "./helpers/event-invitation-fixtures";

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

/**
 * Confirms the resend dialog. Resending asks for its deadline in a dialog of
 * its own, so the deadline belongs to that one resend rather than to a field
 * on the page that silently applied to whichever row was resent next.
 */
async function confirmResend(container: HTMLElement): Promise<void> {
  const dialog = container.querySelector<HTMLDialogElement>("dialog");
  const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent?.trim() === "Resend invitation",
  );
  if (!confirm) throw new Error("the resend dialog did not open");
  await act(async () => confirm.click());
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForElement<T extends Element>(find: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const element = find();
    if (element) return element;
    await settle();
  }
  throw new Error("Expected element was not rendered.");
}

function confirmDialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing confirm dialog button: ${label}`);
  return button;
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal event invitations", () => {
  it.each(["attendees", "speakers"] as const)(
    "bulk revokes eligible %s and reports partial failures",
    async (audience) => {
      const otherId = "30000000-0000-4000-8000-000000000002";
      const lockedId = "30000000-0000-4000-8000-000000000003";
      const paths: string[] = [];
      const builder = audience === "attendees" ? invite : speakerInvite;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const url = urlOf(input);
          if ((init.method ?? "GET") === "GET")
            return json(
              response([
                builder(),
                builder({ id: otherId, inviteeEmail: "fails@example.test" }),
                builder({
                  id: lockedId,
                  inviteeEmail: "accepted@example.test",
                  actions: { resend: false, revoke: false },
                }),
              ]),
            );
          paths.push(url.pathname);
          return url.pathname.includes(otherId)
            ? json({ error: { code: "INVITE_CHANGED", message: "Invitation already accepted" } }, 409)
            : json({ success: true });
        }),
      );
      const container = mount(
        <>
          <ConfirmDialogHost />
          <GroupEventInvitations
            groupId={GROUP_ID}
            event={EVENT}
            inviteType={audience === "attendees" ? "attendee" : "speaker"}
            listPath="/invitations"
          />
        </>,
      );
      await settle();
      const selectAll = container.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
      await act(async () => selectAll.click());
      await settle();
      const revoke = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Revoke selected",
      )!;
      await act(async () => revoke.click());
      await settle();
      await act(async () => confirmDialogButton("Revoke invitations").click());
      await settle();
      await settle();
      expect(paths).toEqual(
        [INVITE_ID, otherId].map(
          (id) =>
            `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/invites${audience === "speakers" ? "/speakers" : ""}/${id}/revoke`,
        ),
      );
      expect(container.textContent).toContain("1 of 2 invitations revoked.");
      expect(container.textContent).toContain("fails@example.test: Invitation already accepted");
      expect(container.querySelector('tbody input[type="checkbox"]:checked')).toBeNull();
    },
  );

  it("uses only canonical group endpoints for server-side search, status filters, sorting, pagination, resend, and revoke", async () => {
    const requests: Array<{ method: string; url: URL; body: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = urlOf(input);
        const method = init.method ?? "GET";
        requests.push({ method, url, body: typeof init.body === "string" ? init.body : null });
        if (method === "GET") return json(response());
        if (url.pathname.endsWith("/resend")) {
          return json({
            success: true,
            inviteId: INVITE_ID,
            resentAt: "2026-08-02T12:00:00.000Z",
            inviteType: "attendee",
            expiresAt: EVENT.startsAt,
          });
        }
        if (url.pathname.endsWith("/revoke")) return json({ success: true });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const container = mount(
      <>
        <ConfirmDialogHost />
        <GroupEventInvitations groupId={GROUP_ID} event={EVENT} listPath="/x" />
      </>,
    );
    await settle();
    const listPath = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/invites`;
    expect(requests[0]).toMatchObject({ method: "GET", url: expect.objectContaining({ pathname: listPath }) });

    // The status filter is the Status column's own, in its menu; no select
    // sits above the table.
    expect(container.querySelector('[role="toolbar"] select')).toBeNull();
    await chooseColumnFilter(container, "Status", "Sent");
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("status")).toBe("sent");
    expect(columnFilterSummary(container, "Status")).toBe("Sent");

    // Located through its label, which now names the list it searches, because
    // a page with several collections used to offer several fields all called
    // "Search".
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "ada";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("q")).toBe("ada");

    const statusSort = Array.from(container.querySelectorAll<HTMLButtonElement>("th button")).find((button) =>
      button.textContent?.includes("Status"),
    )!;
    await act(async () => statusSort.click());
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("sort")).toBe("-status");
    expect(requests.at(-1)?.url.searchParams.get("limit")).toBe("50");
    expect(requests.at(-1)?.url.searchParams.get("offset")).toBe("0");

    // Two actions, so this row collapses into its menu; the helper finds it
    // there without the test having to know that.
    await runRowAction(container, "Ada Lovelace", "Resend invitation");
    await confirmResend(container);
    // The outcome is announced after the list has been reloaded, so the
    // sentence and the row it describes arrive together — one tick for the
    // action, one for the reload behind it.
    await settle();
    await settle();
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        url: expect.objectContaining({ pathname: `${listPath}/${INVITE_ID}/resend` }),
      }),
    );
    const resendRequest = requests.find(
      (request) => request.method === "POST" && request.url.pathname.endsWith(`/${INVITE_ID}/resend`),
    );
    expect(resendRequest?.body).toBe("{}");
    expect(container.textContent).toContain("Invitation resent to Ada Lovelace.");

    await runRowAction(container, "Ada Lovelace", "Revoke invitation");
    await act(async () => confirmDialogButton("Revoke invitation").click());
    await settle();
    await settle();
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        url: expect.objectContaining({ pathname: `${listPath}/${INVITE_ID}/revoke` }),
      }),
    );
    expect(container.textContent).toContain("Invitation revoked for Ada Lovelace.");
    expect(requests.every((request) => !request.url.pathname.startsWith("/api/v1/admin/"))).toBe(true);
  });

  it("renders only server-authorized actions and reports an action error accessibly", async () => {
    let resend = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "GET")
          return json(response([invite({ actions: { resend: true, revoke: false } })]));
        resend = true;
        return json({ error: { code: "INVITE_CHANGED", message: "Invitation is no longer pending." } }, 409);
      }),
    );

    const container = mount(<GroupEventInvitations groupId={GROUP_ID} event={EVENT} listPath="/x" />);
    await settle();
    // Revoke is not authorized here, so resend is the row's only action —
    // still behind the row's menu, whose trigger names the invitee so a page
    // of rows is a page of distinguishable controls.
    expect(rowActionControlNames(container)).toEqual(["Actions for Ada Lovelace"]);

    await runRowAction(container, "Ada Lovelace", "Resend invitation");
    await confirmResend(container);
    await settle();
    expect(resend).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invitation is no longer pending.");
  });

  it("creates attendee invitations through preview-confirmed group endpoints without admin fallback", async () => {
    const requests: Array<{ method: string; url: URL }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = urlOf(input);
        const method = init.method ?? "GET";
        requests.push({ method, url });
        if (method === "GET") return json(response([]));
        if (url.pathname.endsWith("/preview")) {
          return json({
            success: true,
            subject: "Invitation",
            html: "<p>Preview</p>",
            text: "Preview",
            previewToken: "p".repeat(32),
            inviteDigest: "a".repeat(64),
            inviteExpiresAt: EVENT.startsAt,
            previewExpiresAt: "2026-11-30T12:00:00.000Z",
            recipientCount: 1,
            sendBatches: [{ offset: 0, count: 1, previewToken: "p".repeat(32), inviteDigest: "a".repeat(64) }],
          });
        }
        if (url.pathname.endsWith("/bulk"))
          return json({ success: true, created: [{ email: "new@example.test" }], endorsed: [], skipped: [] });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    // Composing is its own page under the list, reached by "Invite attendees".
    const container = mount(<GroupEventInvitations groupId={GROUP_ID} event={EVENT} listPath="/x" segment="new" />);
    await settle();
    const composer = container.querySelector('[aria-label="Send attendee invitations"]')!;
    expect(composer.querySelector('input[aria-label="attendee 1 first name"]')).not.toBeNull();
    expect(composer.querySelector('input[aria-label="attendee 1 last name"]')).not.toBeNull();
    expect(composer.querySelector('input[aria-label="attendee 1 email address"]')).not.toBeNull();
    const textarea = composer.querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.value = "New Person <new@example.test>";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    const parse = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Parse",
    )!;
    await act(async () => parse.click());
    await settle();
    expect(composer.textContent).toContain("1 recipient");
    const preview = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Preview email",
    )!;
    await act(async () => preview.click());
    await settle();
    expect(composer.textContent).toContain("Review and confirm below.");
    const confirm = await waitForElement(() => composer.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    confirm.checked = true;
    confirm.dispatchEvent(new Event("input", { bubbles: true }));
    confirm.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const send = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Send attendee invites",
    )!;
    await act(async () => send.click());
    await settle();
    expect(requests.map((request) => request.url.pathname)).toEqual(
      expect.arrayContaining([
        `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/invites/attendees/preview`,
        `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/invites/attendees/bulk`,
      ]),
    );
    expect(requests.every((request) => !request.url.pathname.startsWith("/api/v1/admin/"))).toBe(true);
  });

  it("creates speaker invitations through the canonical group endpoint without admin fallback", async () => {
    const requests: Array<{ method: string; url: URL }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = urlOf(input);
        const method = init.method ?? "GET";
        requests.push({ method, url });
        if (method === "GET")
          return json({
            invites: [speakerInvite()],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        if (url.pathname.endsWith("/preview")) {
          return json({
            success: true,
            subject: "Speaker invitation",
            html: "<p>Preview</p>",
            text: "Preview",
            previewToken: "p".repeat(32),
            inviteDigest: "a".repeat(64),
            inviteExpiresAt: EVENT.startsAt,
            previewExpiresAt: "2026-11-30T12:00:00.000Z",
            recipientCount: 1,
            sendBatches: [{ offset: 0, count: 1, previewToken: "p".repeat(32), inviteDigest: "a".repeat(64) }],
          });
        }
        if (url.pathname.endsWith("/bulk")) {
          return json({ success: true, created: [{ email: "speaker-new@example.test" }], endorsed: [], skipped: [] });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const container = mount(
      <GroupEventInvitations
        groupId={GROUP_ID}
        event={EVENT}
        inviteType="speaker"
        listPath="/x/speakers"
        segment="new"
      />,
    );
    await settle();
    const composer = container.querySelector('[aria-label="Send speaker invitations"]')!;
    const textarea = composer.querySelector<HTMLTextAreaElement>("textarea")!;
    textarea.value = "New Speaker <speaker-new@example.test>";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    const parse = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Parse",
    )!;
    await act(async () => parse.click());
    await settle();
    const preview = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Preview email",
    )!;
    await act(async () => preview.click());
    await settle();
    const confirm = await waitForElement(() => composer.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    confirm.checked = true;
    confirm.dispatchEvent(new Event("input", { bubbles: true }));
    confirm.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const send = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Send speaker invites",
    )!;
    await act(async () => send.click());
    await settle();
    expect(requests.map((request) => request.url.pathname)).toEqual(
      expect.arrayContaining([
        `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/invites/speakers/preview`,
        `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/invites/speakers/bulk`,
      ]),
    );
    expect(requests.every((request) => !request.url.pathname.startsWith("/api/v1/admin/"))).toBe(true);
  });

  it("appears in event details only when the server reports manage capability", async () => {
    const event: GroupEvent = {
      id: EVENT_ID,
      ownerGroupId: GROUP_ID,
      seriesId: "40000000-0000-4000-8000-000000000001",
      slug: "working-group-meeting",
      basePath: null,
      name: "Working group meeting",
      timezone: "Europe/Amsterdam",
      startsAt: "2026-09-01T12:00:00.000Z",
      endsAt: "2026-09-01T13:00:00.000Z",
      profileKey: "meeting",
      sourceMode: "portal",
      registrationPolicy: "no_registration",
      visibility: "group_members",
      inviteLimitAttendee: 5,
      location: null,
      links: [],
      nextOccurrenceAt: null,
      updatedAt: "2026-08-01T12:00:00.000Z",
      proposalAccess: null,
      capabilities: ["view"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(response())),
    );

    const readOnly = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="invitations" />);
    await settle();
    expect(readOnly.textContent).not.toContain("Attendee invitations");

    const manager = mount(
      <GroupEventWorkspace
        event={{ ...event, capabilities: ["view", "manage"] }}
        groupId={GROUP_ID}
        tab="invitations"
      />,
    );
    await settle();
    expect(manager.textContent).toContain("Attendee invitations");
  });

  /**
   * The two panels are the same component twice on one tab, so everything a
   * reader navigates by has to tell them apart. The ids are generated by
   * `Field` now, so this asserts the thing that actually matters: each
   * deadline control is reached through its own `for`/`id` pair from a label
   * that says which set it belongs to, and the two are different elements.
   */
  it("names the resend deadline, status filter and panel of each invitation set apart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        urlOf(input).pathname.endsWith("/speakers")
          ? json({ invites: [speakerInvite()], page: { limit: 50, offset: 0, total: 1, hasMore: false } })
          : json(response()),
      ),
    );
    const container = mount(
      <>
        <GroupEventInvitations groupId={GROUP_ID} event={EVENT} listPath="/x" />
        <GroupEventInvitations groupId={GROUP_ID} event={EVENT} inviteType="speaker" listPath="/x/speakers" />
      </>,
    );
    await settle();

    // Each set's status filter is in its own table's Status column, and each
    // table is named after its set — so the two menus, which share a name,
    // are told apart by the list they belong to rather than by two selects
    // with two different names.
    const statusMenus = Array.from(container.querySelectorAll('button[aria-label="Status column options"]'));
    expect(statusMenus).toHaveLength(2);
    expect(statusMenus.map((menu) => menu.closest("table")?.querySelector("caption")?.textContent)).toEqual([
      "Attendee invitations",
      "Speaker invitations",
    ]);
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(
      Array.from(container.querySelectorAll("section[aria-label]")).map((s) => s.getAttribute("aria-label")),
    ).toContain("Speaker invitations");

    // Resending asks for its deadline in a dialog named for the set it
    // belongs to, with the rule announced with the control rather than
    // floating beside it. The page carries no standing deadline field.
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    const [attendeeList, speakerList] = Array.from(container.querySelectorAll<HTMLElement>("section.pk-table-list"));
    await runRowAction(attendeeList, "Ada Lovelace", "Resend invitation");
    const attendee = controlFor(container, "Attendee resend deadline");
    expect(attendee.type).toBe("datetime-local");
    const describedBy = attendee.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toContain(
      "cannot be later than the event end",
    );
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("dialog button")]
        .find((button) => button.textContent?.trim() === "Cancel")
        ?.click();
    });

    await runRowAction(speakerList, "Ada Lovelace", "Resend invitation");
    const speaker = controlFor(container, "Speaker resend deadline");
    expect(speaker.type).toBe("datetime-local");
    expect(speaker).not.toBe(attendee);
  });

  it("offers every invitation status the list contract accepts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(response([]))),
    );
    const container = mount(<GroupEventInvitations groupId={GROUP_ID} event={EVENT} listPath="/x" />);
    await settle();

    // "All statuses" is the filter's own way of saying "no filter" and is not
    // a status an invitation can hold; every status that is one is offered.
    const offered = columnFilterOptions(container, "Status");
    expect(offered).toEqual(["All statuses", "Sent", "Accepted", "Declined", "Expired", "Revoked"]);
    expect(offered).toHaveLength(EVENT_INVITE_STATUSES.length + 1);
  });
});
