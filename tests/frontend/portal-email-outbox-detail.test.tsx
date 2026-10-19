// @vitest-environment jsdom
/**
 * What a reader of the outbox learns from one queued message: where it is
 * going, why it failed, and exactly what will be sent. The list's own
 * behavior is covered in portal-system-operations.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIRECT_EMAIL_TEMPLATE_KEY, emailOutboxDetailResponseSchema } from "../../assets/shared/schemas/email-outbox";
import { EmailOutbox } from "../../assets/ts/member-flows/portal/sections/system-operations/EmailOutbox";
import { EmailOutboxDetail } from "../../assets/ts/member-flows/portal/sections/system-operations/EmailOutboxDetail";

let container: HTMLDivElement | null = null;

const campaignRowId = "11111111-1111-4111-8111-111111111111:alex@example.test";

function message(overrides: Record<string, unknown> = {}) {
  return emailOutboxDetailResponseSchema.parse({
    message: {
      id: campaignRowId,
      eventSlug: null,
      eventName: null,
      templateKey: DIRECT_EMAIL_TEMPLATE_KEY,
      templateVersion: null,
      recipientEmail: "alex@example.test",
      recipientName: "Alex Example",
      subject: "Review your organization profile",
      messageType: "transactional",
      provider: "sendgrid",
      providerMessageId: null,
      status: "failed",
      attempts: 2,
      sendAfter: "2026-09-17T12:00:00.000Z",
      createdAt: "2026-09-17T12:00:00.000Z",
      updatedAt: "2026-09-17T12:01:00.000Z",
      sentAt: null,
      lastError: "The provider could not deliver the message. Check the recipient address before retrying.",
      bccRecipientCount: 0,
      hasCalendarInvite: false,
      hasBadgeAttachment: false,
      usesDirectBody: true,
      hasCustomText: false,
      bodyContent: "Dear {{firstName}},\n\nThis is the edited message.",
      customText: null,
      ...overrides,
    },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(vnode: preact.VNode, respond: (path: string) => unknown): Promise<string[]> {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      paths.push(url.pathname);
      return json(respond(url.pathname));
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  await act(() => render(vnode, container!));
  await settle();
  return paths;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("portal email outbox message", () => {
  it("opens from its list row at an address that keeps a campaign row's colon encoded", async () => {
    const { message: row } = message();
    await mount(<EmailOutbox canManage={false} />, () => ({
      outbox: [row],
      page: { limit: 25, offset: 0, total: 1, hasMore: false },
    }));

    const link = container!.querySelector<HTMLAnchorElement>(`a[href^="#/settings/email-outbox/"]`);
    expect(link?.getAttribute("href")).toBe(`#/settings/email-outbox/${encodeURIComponent(campaignRowId)}`);
  });

  it("states the failure, the recipient, and the stored body of a message that carries its own text", async () => {
    const paths = await mount(<EmailOutboxDetail id={encodeURIComponent(campaignRowId)} />, () => message());

    expect(paths).toEqual([`/api/v1/email/outbox/${encodeURIComponent(campaignRowId)}`]);
    expect(container!.querySelector("h1, h2")?.textContent).toBe("Review your organization profile");
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("Check the recipient address");
    expect(container!.textContent).toContain("Alex Example <alex@example.test>");
    // A direct message resolves no stored template, and says so.
    expect(container!.textContent).toMatch(/Source template\s*None/);
    expect(container!.querySelector('section[aria-label="Queued message"]')?.textContent).toContain(
      "This is the edited message.",
    );
  });

  it("shows the template version and only the custom text of a template-backed message", async () => {
    await mount(<EmailOutboxDetail id="22222222-2222-4222-8222-222222222222" />, () =>
      message({
        id: "22222222-2222-4222-8222-222222222222",
        templateKey: "organization-invitation",
        templateVersion: 3,
        usesDirectBody: false,
        hasCustomText: true,
        lastError: null,
        status: "queued",
        bodyContent: null,
        customText: "A note from the organizer.",
      }),
    );

    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(container!.textContent).toMatch(/Template\s*organization-invitation v3/);
    expect(container!.querySelector('section[aria-label="Queued message"]')).toBeNull();
    expect(container!.querySelector('section[aria-label="Custom message text"]')?.textContent).toContain(
      "A note from the organizer.",
    );
  });
});
