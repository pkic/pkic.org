// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Invites } from "../../assets/ts/admin/sections/events/detail/Invites";
import type { EventDetail } from "../../assets/ts/admin/types";

const mounted: HTMLElement[] = [];
const EVENT: EventDetail = {
  id: "20000000-0000-4000-8000-000000000001",
  slug: "example-event",
  name: "Example event",
  timezone: "UTC",
  starts_at: "2026-12-01T08:00:00.000Z",
  ends_at: "2026-12-02T18:00:00.000Z",
  registration_mode: "invite_or_open",
  invite_limit_attendee: 5,
  base_path: null,
  user_retention_days: null,
  venue: null,
  virtual_url: null,
  hero_image_url: null,
  location: null,
  session_types: null,
  ownerGroupId: null,
  sourceMode: "portal",
  settings: {},
};

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

describe("admin speaker invitations", () => {
  it("keeps only the transitional speaker list and revoke lifecycle on the speaker endpoint", async () => {
    const requests: Array<{ method: string; url: URL }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = urlOf(input);
        const method = init.method ?? "GET";
        requests.push({ method, url });
        if (method === "GET") {
          return json({
            invites: [
              {
                id: "30000000-0000-4000-8000-000000000001",
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
                expiresAt: null,
                acceptedAt: null,
                declinedAt: null,
                createdAt: "2026-08-01T12:00:00.000Z",
                inviterUserId: null,
                inviterEmail: null,
                inviterFirstName: null,
                inviterLastName: null,
                actions: { resend: true, revoke: true },
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        }
        return json({ success: true });
      }),
    );
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    const container = mount(<Invites slug="example-event" event={EVENT} inviteType="speaker" />);
    const listTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Speaker Invite List",
    );
    expect(listTab).toBeTruthy();
    await act(async () => listTab?.click());
    await settle();

    const endpoint = "/api/v1/admin/events/example-event/invites";
    expect(requests[0]).toMatchObject({ method: "GET", url: expect.objectContaining({ pathname: endpoint }) });
    const revoke = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Revoke",
    );
    await act(async () => revoke?.click());
    await settle();
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        url: expect.objectContaining({ pathname: `${endpoint}/30000000-0000-4000-8000-000000000001/revoke` }),
      }),
    );
    expect(requests.every((request) => !request.url.pathname.includes("/attendees"))).toBe(true);
  });

  it("leaves attendee bulk send without the retired list and revoke tab", () => {
    const container = mount(<Invites slug="example-event" event={EVENT} inviteType="attendee" />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).not.toContain("Invite List");
    expect(container.textContent).toContain("Send Attendee Invites");
  });
});
