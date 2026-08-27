// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventAttendeeInviteSummary, EventInviteSummary } from "../../assets/shared/schemas/event-invites";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { GroupEventDetail } from "../../assets/ts/member-flows/portal/sections/management/GroupEventDetail";
import { GroupEventInvitations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventInvitations";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const INVITE_ID = "30000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];
const EVENT: GroupEvent = {
  id: EVENT_ID,
  ownerGroupId: GROUP_ID,
  seriesId: null,
  slug: "working-group-event",
  basePath: null,
  name: "Working group event",
  timezone: "UTC",
  startsAt: "2026-12-01T08:00:00.000Z",
  endsAt: "2026-12-01T18:00:00.000Z",
  profileKey: "workshop",
  sourceMode: "portal",
  registrationPolicy: "public",
  inviteLimitAttendee: 5,
  location: null,
  links: [],
  nextOccurrenceAt: null,
  updatedAt: "2026-08-01T12:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "manage"],
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function response(invites: EventAttendeeInviteSummary[] = [invite()]): {
  invites: EventAttendeeInviteSummary[];
  page: object;
} {
  return {
    invites,
    page: { limit: 50, offset: 0, total: invites.length, hasMore: false },
  };
}

function invite(overrides: Partial<EventAttendeeInviteSummary> = {}): EventAttendeeInviteSummary {
  return {
    id: INVITE_ID,
    inviteeEmail: "invitee@example.test",
    inviteeFirstName: "Ada",
    inviteeLastName: "Lovelace",
    inviteType: "attendee",
    status: "sent",
    expiresAt: "2026-09-01T12:00:00.000Z",
    acceptedAt: null,
    declinedAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    actions: { resend: true, revoke: true },
    ...overrides,
  };
}

function speakerInvite(overrides: Partial<EventInviteSummary> = {}): EventInviteSummary {
  return {
    id: INVITE_ID,
    inviteeEmail: "speaker@example.test",
    inviteeFirstName: "Ada",
    inviteeLastName: "Lovelace",
    inviteType: "speaker",
    status: "sent",
    declineReasonCode: null,
    declineReasonNote: null,
    unsubscribeFuture: 0,
    reminderCount: 0,
    sourceType: "staff",
    expiresAt: "2026-09-01T12:00:00.000Z",
    acceptedAt: null,
    declinedAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    inviterUserId: null,
    inviterEmail: null,
    inviterFirstName: null,
    inviterLastName: null,
    actions: { resend: true, revoke: true },
    ...overrides,
  };
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

async function waitForElement<T extends Element>(find: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const element = find();
    if (element) return element;
    await settle();
  }
  throw new Error("Expected element was not rendered.");
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
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    const container = mount(<GroupEventInvitations groupId={GROUP_ID} event={EVENT} />);
    await settle();
    const listPath = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/invites`;
    expect(requests[0]).toMatchObject({ method: "GET", url: expect.objectContaining({ pathname: listPath }) });

    const status = container.querySelector<HTMLSelectElement>('select[aria-label="Invitation status"]')!;
    status.value = "sent";
    status.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("status")).toBe("sent");

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search invitations…"]')!;
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

    const resend = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Resend invitation to Ada Lovelace"]',
    )!;
    await act(async () => resend.click());
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

    const revoke = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Revoke invitation for Ada Lovelace"]'),
    );
    await act(async () => revoke.click());
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

    const container = mount(<GroupEventInvitations groupId={GROUP_ID} event={EVENT} />);
    await settle();
    expect(container.querySelector('button[aria-label="Revoke invitation for Ada Lovelace"]')).toBeNull();

    const resendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Resend invitation to Ada Lovelace"]',
    )!;
    await act(async () => resendButton.click());
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

    const container = mount(<GroupEventInvitations groupId={GROUP_ID} event={EVENT} />);
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
    expect(composer.textContent).toContain("1 valid");
    const preview = Array.from(composer.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Preview email",
    )!;
    await act(async () => preview.click());
    await settle();
    expect(composer.textContent).toContain("Review and confirm below.");
    const confirm = await waitForElement(() => composer.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    confirm.checked = true;
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

    const container = mount(<GroupEventInvitations groupId={GROUP_ID} event={EVENT} inviteType="speaker" />);
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

    const readOnly = mount(<GroupEventDetail event={event} groupId={GROUP_ID} />);
    await settle();
    expect(readOnly.textContent).not.toContain("Attendee invitations");

    const manager = mount(
      <GroupEventDetail event={{ ...event, capabilities: ["view", "manage"] }} groupId={GROUP_ID} />,
    );
    await settle();
    expect(manager.textContent).toContain("Attendee invitations");
  });

  it("uses distinct resend deadline controls for attendee and speaker invitations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(response([]))),
    );
    const container = mount(
      <>
        <GroupEventInvitations groupId={GROUP_ID} event={EVENT} />
        <GroupEventInvitations groupId={GROUP_ID} event={EVENT} inviteType="speaker" />
      </>,
    );
    await settle();
    const ids = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[id^="group-event-invite-deadline-"]'),
    ).map((input) => input.id);
    expect(ids).toEqual([
      `group-event-invite-deadline-${EVENT_ID}-attendee`,
      `group-event-invite-deadline-${EVENT_ID}-speaker`,
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
