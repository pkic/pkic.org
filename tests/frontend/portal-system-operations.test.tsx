// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduledWork } from "../../assets/ts/member-flows/portal/sections/system-operations/ScheduledWork";
import { EmailOutbox } from "../../assets/ts/member-flows/portal/sections/system-operations/EmailOutbox";
import { emailOutboxProcessSchema, emailOutboxResetFailedSchema } from "../../assets/shared/schemas/email-outbox";

let container: HTMLDivElement | null = null;
let toastArea: HTMLDivElement | null = null;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The portal's toast target, so a failure path has somewhere to land. */
function mountToastArea(): HTMLDivElement {
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(toastArea);
  return toastArea;
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!found) throw new Error(`No button labelled ${label}`);
  return found;
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
  if (toastArea) {
    toastArea.remove();
    toastArea = null;
  }
  vi.unstubAllGlobals();
});

describe("portal Operations scheduled-work reads", () => {
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
        if (url.pathname === "/api/v1/retention/due") {
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
        <ScheduledWork
          canManageEmail={false}
          canRunRetention={true}
          canAnonymizeUsers={false}
          canWriteMembership={false}
          canApproveMembership={false}
        />,
        container!,
      ),
    );
    await settle();

    expect(requests.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual(["GET /api/v1/retention/due"]);
    expect(container.textContent).toContain("available only to staff holding that domain");
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
    // The table names itself, so a page listing several tables does not read
    // out several anonymous ones.
    expect(container.querySelector("caption")?.textContent).toBe("Email outbox messages");
    // No selection column at all without email:manage — not a disabled one.
    expect(container.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(
      [...container.querySelectorAll("button")].some((control) =>
        /process|reset|retry/i.test(control.textContent ?? ""),
      ),
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
    const processButton = button(container, "Process next 20 due");
    await act(() => {
      processButton.click();
    });
    await settle();
    for (let attempt = 0; attempt < 3; attempt += 1) await settle();
    const processRequest = requests.find(({ url }) => url.pathname === "/api/v1/email/outbox/process")!;
    expect(processRequest.method).toBe("POST");
    // Through the shared request contract, not a literal: a body that the
    // endpoint would reject must fail here too.
    expect(emailOutboxProcessSchema.parse(processRequest.body).limit).toBe(20);

    // The selection control is a labelled checkbox, named by its own label
    // element rather than a bare aria-label on an unlabelled box.
    const selectLabel = [...container.querySelectorAll("label.pk-check")].find((label) =>
      label.textContent?.includes("Select Notice"),
    )!;
    expect(selectLabel.querySelector(".pk-check__label")?.textContent).toBe("Select Notice");
    const checkbox = selectLabel.querySelector<HTMLInputElement>("input.pk-check__input")!;
    await act(() => {
      checkbox.click();
    });
    const resetButton = button(container, "Reset failed selected");
    await act(() => {
      resetButton.click();
    });
    await settle();
    const resetRequest = requests.find(({ url }) => url.pathname === "/api/v1/email/outbox/reset-failed")!;
    expect(resetRequest.method).toBe("POST");
    expect(emailOutboxResetFailedSchema.parse(resetRequest.body).ids).toEqual([failedId]);
    expect(
      requests.some(
        ({ url }) => url.pathname.startsWith("/api/v1/admin/") || url.pathname.startsWith("/api/v1/internal/"),
      ),
    ).toBe(false);
  });

  it("reports a rejected process command and leaves the control usable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
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
        if (url.pathname === "/api/v1/email/outbox/process") {
          return apiError(503, "PROVIDER_UNAVAILABLE", "The email provider is not accepting messages.");
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const toasts = mountToastArea();
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<EmailOutbox canManage />, container!));
    await settle();

    await act(() => {
      button(container!, "Process next 20 due").click();
    });
    for (let attempt = 0; attempt < 3; attempt += 1) await settle();

    expect(toasts.textContent).toContain("The email provider is not accepting messages.");
    // A failed command must hand the control back rather than stranding the
    // page in its busy state.
    expect(button(container, "Process next 20 due").disabled).toBe(false);
  });
});

describe("portal Operations command visibility", () => {
  async function renderScheduledWork(options: {
    canManageEmail: boolean;
    canRunRetention: boolean;
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
        if (url.pathname === "/api/v1/retention/due") {
          return json({
            items: [],
            counts: { all: 0, outbox: 0, reminders: 0, cleanup: 0 },
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    await act(() => render(<ScheduledWork {...options} />, container!));
    await settle();
  }

  it("keeps preview readable while gating each operational command by its exact capability", async () => {
    container = document.createElement("div");
    document.body.append(container);

    await renderScheduledWork({
      canManageEmail: false,
      canRunRetention: true,
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

    await renderScheduledWork({
      canManageEmail: true,
      canRunRetention: true,
      canAnonymizeUsers: false,
      canWriteMembership: false,
      canApproveMembership: false,
    });
    expect(container.textContent).toContain("Queue reminders");
    // The chair digest queues member email, so it now requires membership:write
    // rather than a blanket operational run grant.
    expect(container.textContent).not.toContain("Queue chair digest");
    expect(container.textContent).not.toContain("Run consultation batch");
    expect(container.textContent).not.toContain("Run EC review batch");
    expect(container.textContent).not.toContain("Run retention redaction");

    await renderScheduledWork({
      canManageEmail: true,
      canRunRetention: true,
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
        if (url.pathname === "/api/v1/retention/due") {
          return json({
            items: [],
            counts: { all: 0, outbox: 0, reminders: 0, cleanup: 0 },
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          });
        }
        if (url.pathname === "/api/v1/email/reminders/runs") {
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
        <ScheduledWork
          canManageEmail={false}
          canRunRetention={true}
          canAnonymizeUsers={false}
          canWriteMembership={false}
          canApproveMembership={false}
        />,
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
    expect(requests.find(({ url }) => url.pathname === "/api/v1/email/reminders/runs")).toMatchObject({
      method: "POST",
      body: { limit: 120 },
    });
    expect(
      requests.some(
        ({ url }) => url.pathname.startsWith("/api/v1/admin/") || url.pathname.startsWith("/api/v1/internal/"),
      ),
    ).toBe(false);
  });

  it("names the panel, its read-only state, and the batch-size control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ items: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }))),
    );
    mountToastArea();
    const host = document.createElement("div");
    container = host;
    document.body.append(host);
    await act(async () => {
      render(
        <ScheduledWork
          canManageEmail={false}
          canRunRetention={false}
          canAnonymizeUsers={false}
          canWriteMembership={false}
          canApproveMembership={false}
        />,
        host,
      );
      await Promise.resolve();
    });
    await settle();

    expect(container.querySelector(".pk-panel__title")?.textContent).toBe("Scheduled Work");
    // The read-only state is a word, not only a grey chip.
    expect(container.querySelector(".pk-badge")?.textContent).toBe("Read only");

    // The batch-size control owns a real label/for pair and its guidance is
    // wired to it by aria-describedby rather than sitting loose beside it.
    const label = [...container.querySelectorAll("label")].find((candidate) =>
      candidate.textContent?.startsWith("Reminder batch size"),
    );
    expect(label).toBeDefined();
    const input = container.querySelector<HTMLInputElement>(`#${label?.htmlFor ?? ""}`);
    expect(input?.type).toBe("number");
    const describedBy = input?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${describedBy ?? ""}`)?.textContent).toContain("Between 1 and 500");
  });

  it("keeps the panel and its controls usable when the retention list fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(apiError(500, "server_error", "HTTP 500"))),
    );
    mountToastArea();
    const host = document.createElement("div");
    container = host;
    document.body.append(host);
    await act(async () => {
      render(
        <ScheduledWork
          canManageEmail
          canRunRetention
          canAnonymizeUsers={false}
          canWriteMembership={false}
          canApproveMembership={false}
        />,
        host,
      );
      await Promise.resolve();
    });
    await settle();

    // The failure is stated in plain words, not raw transport phrasing.
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Something went wrong on our side.");
    // And the surface around it survives, so the reader can retry.
    expect(container.querySelector(".pk-panel__title")?.textContent).toBe("Scheduled Work");
    const label = [...container.querySelectorAll("label")].find((candidate) =>
      candidate.textContent?.startsWith("Reminder batch size"),
    );
    expect(container.querySelector<HTMLInputElement>(`#${label?.htmlFor ?? ""}`)?.disabled).toBe(false);
  });
});
