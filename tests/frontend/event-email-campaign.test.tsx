// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { EventEmailCampaign } from "../../assets/ts/components/events/EventEmailCampaign";
import { GroupEventDetail } from "../../assets/ts/member-flows/portal/sections/management/GroupEventDetail";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
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

function urlOf(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

async function inputText(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event email campaign UI", () => {
  it("previews and creates a campaign through one canonical nested resource", async () => {
    const eventPath = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}`;
    const campaignPath = `${eventPath}/email/campaigns`;
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = urlOf(input);
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ method, path: url.pathname, body });
        if (method === "GET" && url.pathname === "/api/v1/email/templates") {
          return json({ templates: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (method === "GET" && url.pathname.endsWith("/days")) {
          return json({ days: [], eventUpdatedAt: "2026-08-29T08:00:00.000Z" });
        }
        if (method === "POST" && url.pathname === `${campaignPath}/previews`) {
          return json({
            success: true,
            recipientCount: 1,
            batchCount: 1,
            previewToken: "campaign-preview-token",
            previewExpiresAt: "2026-08-29T08:10:00.000Z",
            sampleRecipients: ["attendee@example.test"],
            subject: "Working group update",
            html: "<p>Hello</p>",
            text: "Hello",
          });
        }
        if (method === "POST" && url.pathname === campaignPath) {
          return json({ success: true, queuedRecipients: 1, queuedBatches: 1, mode: "personal" }, 202);
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const container = mount(<EventEmailCampaign campaignsPath={campaignPath} daysPath={`${eventPath}/days`} />);
    await inputText(
      container.querySelector<HTMLInputElement>('input[placeholder="Email subject"]')!,
      "Working group update",
    );
    await inputText(container.querySelector<HTMLTextAreaElement>("textarea")!, "Hello {{firstName}}");
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview Email")!.click();
    });
    await settle();

    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: `${campaignPath}/previews`,
        body: expect.objectContaining({ filter: expect.objectContaining({ audience: "attendees" }) }),
      }),
    );
    const confirmation = container.querySelector<HTMLInputElement>("#em-confirm")!;
    await act(async () => confirmation.click());
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Send Email")!.click();
    });
    await settle();
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: campaignPath,
        body: expect.objectContaining({ previewToken: "campaign-preview-token" }),
      }),
    );
    expect(requests.every(({ path }) => !path.startsWith("/api/v1/admin/"))).toBe(true);
  });

  it("does not render campaign management without the server-provided manage capability", () => {
    const event: GroupEvent = {
      id: EVENT_ID,
      ownerGroupId: GROUP_ID,
      seriesId: null,
      slug: "read-only-event",
      basePath: null,
      name: "Read-only event",
      timezone: "UTC",
      startsAt: "2026-12-01T08:00:00.000Z",
      endsAt: "2026-12-01T18:00:00.000Z",
      profileKey: "workshop",
      sourceMode: "portal",
      registrationPolicy: "no_registration",
      visibility: "group_members",
      inviteLimitAttendee: 5,
      location: null,
      links: [],
      nextOccurrenceAt: null,
      updatedAt: "2026-08-29T08:00:00.000Z",
      proposalAccess: null,
      capabilities: ["view"],
    };
    const container = mount(<GroupEventDetail event={event} groupId={GROUP_ID} />);
    expect(container.textContent).not.toContain("Email campaigns");
  });
});
