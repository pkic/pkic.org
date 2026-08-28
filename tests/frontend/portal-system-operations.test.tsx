// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DueWork } from "../../assets/ts/member-flows/portal/sections/system-operations/DueWork";
import { EmailOutbox } from "../../assets/ts/member-flows/portal/sections/system-operations/EmailOutbox";

let container: HTMLDivElement | null = null;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("portal Operations due-work reads", () => {
  it("loads only the bounded GET projection and makes no command request on mount", async () => {
    const requests: Array<{ method: string; url: URL; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        requests.push({ method, url, body: null });
        if (url.pathname === "/api/v1/operations/due-work") {
          return json({
            items: [],
            counts: { all: 0, outbox: 0, reminders: 0, cleanup: 0 },
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <DueWork canRun={false} canAnonymizeUsers={false} canWriteMembership={false} canApproveMembership={false} />,
        container!,
      ),
    );
    await settle();

    expect(requests.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual(["GET /api/v1/operations/due-work"]);
    expect(container.textContent).toContain(
      "Run controls are available only to staff with the relevant operation permissions",
    );
    expect(
      requests.some(
        ({ url }) => url.pathname.startsWith("/api/v1/admin/") || url.pathname.startsWith("/api/v1/internal/"),
      ),
    ).toBe(false);
  });
});

describe("portal Operations outbox reads", () => {
  it("uses the canonical outbox projection and hides processing controls without email:manage", async () => {
    const requests: Array<{ method: string; url: URL }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        requests.push({ method, url });
        if (url.pathname === "/api/v1/email/outbox") {
          return json({
            outbox: [],
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
            summary: {
              total: 0,
              byStatus: {},
              byMessageType: {},
              topTemplates: [],
              dueNow: 0,
              dueByStatus: {},
              nextSendAfter: null,
            },
          });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<EmailOutbox canManage={false} />, container!));
    await settle();

    expect(requests.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual(["GET /api/v1/email/outbox"]);
    expect(container.textContent).toContain("Read only");
    expect(
      [...container.querySelectorAll("button")].some((button) => /process|reset|retry/i.test(button.textContent ?? "")),
    ).toBe(false);
    expect(
      requests.some(
        ({ url }) => url.pathname.startsWith("/api/v1/admin/") || url.pathname.startsWith("/api/v1/internal/"),
      ),
    ).toBe(false);
  });

  it("exposes bounded canonical process/reset commands and sends exact selected IDs", async () => {
    const requests: Array<{ method: string; url: URL; body: unknown }> = [];
    const failedId = "00000000-0000-4000-8000-000000000002";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ method, url, body });
        if (url.pathname === "/api/v1/email/outbox") {
          return json({
            outbox: [
              {
                id: failedId,
                eventSlug: null,
                eventName: null,
                templateKey: "notice",
                templateVersion: 1,
                recipientEmail: "failed@example.test",
                recipientName: "Failed Recipient",
                subject: "Notice",
                messageType: "transactional",
                provider: "test",
                providerMessageId: null,
                status: "failed",
                attempts: 1,
                sendAfter: "2026-01-01T00:00:00Z",
                lastError: "provider unavailable",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                sentAt: null,
                bccRecipientCount: 0,
                hasCalendarInvite: false,
                hasBadgeAttachment: false,
                usesDirectBody: false,
                hasCustomText: false,
              },
            ],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
            summary: {
              total: 1,
              byStatus: { failed: 1 },
              byMessageType: { transactional: 1 },
              topTemplates: [],
              dueNow: 0,
              dueByStatus: {},
              nextSendAfter: null,
            },
          });
        }
        if (url.pathname === "/api/v1/email/outbox/process") {
          return json({ success: true, processed: 1, failed: 0, skipped: 0 });
        }
        if (url.pathname === "/api/v1/email/outbox/reset-failed") {
          return json({ success: true, reset: 1, processed: 1, failed: 0, skipped: 0 });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<EmailOutbox canManage />, container!));
    await settle();

    expect(container.textContent).toContain("Process next 20 due");
    expect(container.textContent).not.toContain("Process all due");
    const processButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Process next 20 due"),
    )!;
    await act(() => {
      processButton.click();
    });
    await settle();
    for (let attempt = 0; attempt < 3; attempt += 1) await settle();
    expect(requests.find(({ url }) => url.pathname === "/api/v1/email/outbox/process")).toMatchObject({
      method: "POST",
      body: { limit: 20 },
    });

    const checkbox = container.querySelector<HTMLInputElement>(`input[aria-label="Select Notice"]`)!;
    await act(() => {
      checkbox.click();
    });
    const resetButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Reset failed selected"),
    )!;
    await act(() => {
      resetButton.click();
    });
    await settle();
    expect(requests.find(({ url }) => url.pathname === "/api/v1/email/outbox/reset-failed")).toMatchObject({
      method: "POST",
      body: { ids: [failedId] },
    });
    expect(
      requests.some(
        ({ url }) => url.pathname.startsWith("/api/v1/admin/") || url.pathname.startsWith("/api/v1/internal/"),
      ),
    ).toBe(false);
  });
});

describe("portal Operations command visibility", () => {
  async function renderDueWork(options: {
    canRun: boolean;
    canAnonymizeUsers: boolean;
    canWriteMembership: boolean;
    canApproveMembership: boolean;
  }): Promise<void> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/operations/due-work") {
          return json({
            items: [],
            counts: { all: 0, outbox: 0, reminders: 0, cleanup: 0 },
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    await act(() => render(<DueWork {...options} />, container!));
    await settle();
  }

  it("keeps preview readable while gating each operational command by its exact capability", async () => {
    container = document.createElement("div");
    document.body.append(container);

    await renderDueWork({
      canRun: false,
      canAnonymizeUsers: false,
      canWriteMembership: false,
      canApproveMembership: false,
    });
    expect(container.textContent).toContain("Preview reminders");
    expect(container.textContent).not.toContain("Queue reminders");
    expect(container.textContent).not.toContain("Queue chair digest");
    expect(container.textContent).not.toContain("Run consultation batch");
    expect(container.textContent).not.toContain("Run EC review batch");
    expect(container.textContent).not.toContain("Run retention redaction");

    await renderDueWork({
      canRun: true,
      canAnonymizeUsers: false,
      canWriteMembership: false,
      canApproveMembership: false,
    });
    expect(container.textContent).toContain("Queue reminders");
    expect(container.textContent).toContain("Queue chair digest");
    expect(container.textContent).not.toContain("Run consultation batch");
    expect(container.textContent).not.toContain("Run EC review batch");
    expect(container.textContent).not.toContain("Run retention redaction");

    await renderDueWork({
      canRun: true,
      canAnonymizeUsers: true,
      canWriteMembership: true,
      canApproveMembership: true,
    });
    expect(container.textContent).toContain("Run consultation batch");
    expect(container.textContent).toContain("Run EC review batch");
    expect(container.textContent).toContain("Run retention redaction");
  });

  it("posts reminder preview to the canonical read-only command route", async () => {
    const requests: Array<{ method: string; url: URL; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ method, url, body });
        if (url.pathname === "/api/v1/operations/due-work") {
          return json({
            items: [],
            counts: { all: 0, outbox: 0, reminders: 0, cleanup: 0 },
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          });
        }
        if (url.pathname === "/api/v1/operations/reminders/preview") {
          return json({
            success: true,
            dryRun: true,
            inviteRemindersQueued: 0,
            speakerInviteRemindersQueued: 0,
            presentationRemindersQueued: 0,
            confirmationRemindersQueued: 0,
            confirmationCancellationsProcessed: 0,
            processed: 0,
            preview: {
              attendeeInvites: [],
              speakerInvites: [],
              coSpeakerInvites: [],
              presentationUploads: [],
              registrationConfirmations: [],
            },
          });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <DueWork canRun={false} canAnonymizeUsers={false} canWriteMembership={false} canApproveMembership={false} />,
        container!,
      ),
    );
    await settle();
    const previewButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Preview reminders"),
    )!;
    await act(() => {
      previewButton.click();
    });
    await settle();
    expect(requests.find(({ url }) => url.pathname === "/api/v1/operations/reminders/preview")).toMatchObject({
      method: "POST",
      body: { limit: 120 },
    });
    expect(
      requests.some(
        ({ url }) => url.pathname.startsWith("/api/v1/admin/") || url.pathname.startsWith("/api/v1/internal/"),
      ),
    ).toBe(false);
  });
});
