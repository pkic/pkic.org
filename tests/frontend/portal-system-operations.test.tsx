// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduledWork } from "../../assets/ts/member-flows/portal/sections/system-operations/ScheduledWork";
import { EmailOutbox } from "../../assets/ts/member-flows/portal/sections/system-operations/EmailOutbox";
import { ScheduledJobs } from "../../assets/ts/member-flows/portal/sections/system-operations/ScheduledJobs";
import type { ScheduledJobResource } from "../../assets/shared/schemas/scheduler";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { typedConfirmationInput } from "./helpers/confirm-dialog";

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

function scheduledJob(overrides: Partial<ScheduledJobResource> = {}): ScheduledJobResource {
  return {
    jobKey: "retention",
    intervalSeconds: 86_400,
    nextRunAt: "2026-09-01T00:00:00.000Z",
    wakeRequested: false,
    lastRunAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    consecutiveFailures: 0,
    consecutiveAbandoned: 0,
    runningSince: null,
    leaseExpiresAt: null,
    pausedAt: null,
    pausedReason: null,
    leaseExpired: false,
    capabilities: { manageState: false, run: false },
    ...overrides,
  };
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
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
});

describe("portal scheduled-job management", () => {
  it("renders the bounded registry without reconstructing server-denied actions", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        requests.push(`${method} ${url.pathname}`);
        if (url.pathname === "/api/v1/scheduler/jobs") return json({ jobs: [scheduledJob()] });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ScheduledJobs />, container!));
    await settle();

    expect(container.textContent).toContain("Retention");
    expect(container.textContent).toContain("1 day");
    expect(container.textContent).not.toContain("Run now");
    expect(container.textContent).not.toContain("Pause");
    expect(container.textContent).not.toContain("Resume");
    expect(requests).toEqual(["GET /api/v1/scheduler/jobs"]);
  });

  it("uses the canonical state resource and runs collection for server-authorized controls", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    let current = scheduledJob({ capabilities: { manageState: true, run: true } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ method, path: url.pathname, body });
        if (url.pathname === "/api/v1/scheduler/jobs" && method === "GET") return json({ jobs: [current] });
        if (url.pathname === "/api/v1/scheduler/jobs/retention" && method === "PATCH") {
          const state = (body as { state: "active" | "paused" }).state;
          current = scheduledJob({
            capabilities: { manageState: true, run: true },
            pausedAt: state === "paused" ? "2026-08-30T00:00:00.000Z" : null,
            pausedReason: state === "paused" ? (body as { reason: string }).reason : null,
          });
          return json({ success: true, job: current });
        }
        if (url.pathname === "/api/v1/scheduler/jobs/retention/runs" && method === "POST") {
          current = scheduledJob({
            capabilities: { manageState: true, run: true },
            lastRunAt: "2026-08-30T00:00:01.000Z",
            lastSuccessAt: "2026-08-30T00:00:01.000Z",
            lastStatus: "succeeded",
            lastDurationMs: 12,
          });
          return json({ success: true, jobKey: "retention", status: "succeeded", durationMs: 12 });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ScheduledJobs />, container!));
    await settle();

    const pause = [...container.querySelectorAll("button")].find((button) => button.textContent === "Pause")!;
    await act(() => pause.click());
    const reason = container.querySelector<HTMLTextAreaElement>("#pause-reason-retention")!;
    await act(() => {
      reason.value = "investigating delivery failures";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent === "Confirm pause")!;
    await act(() => confirm.click());
    await settle();
    expect(container.textContent).toContain("Resume");

    const resume = [...container.querySelectorAll("button")].find((button) => button.textContent === "Resume")!;
    await act(() => resume.click());
    await settle();
    const run = [...container.querySelectorAll("button")].find((button) => button.textContent === "Run now")!;
    await act(() => run.click());
    for (let attempt = 0; attempt < 3; attempt += 1) await settle();

    expect(requests).toEqual(
      expect.arrayContaining([
        {
          method: "PATCH",
          path: "/api/v1/scheduler/jobs/retention",
          body: { state: "paused", reason: "investigating delivery failures" },
        },
        { method: "PATCH", path: "/api/v1/scheduler/jobs/retention", body: { state: "active" } },
        { method: "POST", path: "/api/v1/scheduler/jobs/retention/runs", body: {} },
      ]),
    );
    expect(requests.some(({ path }) => path.endsWith("/pause") || path.endsWith("/resume"))).toBe(false);
    expect(container.textContent).toContain("Succeeded");
  });
});

describe("portal Operations retention redaction confirmation", () => {
  it("requires the typed REDACT confirmation and only runs redaction once confirmed", async () => {
    const requests: Array<{ method: string; pathname: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ method, pathname: url.pathname, body });
        if (url.pathname === "/api/v1/retention/due") {
          return json({
            items: [],
            counts: { all: 0, outbox: 0, reminders: 0, cleanup: 0 },
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          });
        }
        if (url.pathname === "/api/v1/retention/runs") {
          return json({ success: true, redactedRegistrations: 3, redactedUsers: 1 });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <ScheduledWork canManageEmail canRunRetention canAnonymizeUsers canWriteMembership canApproveMembership />
        </>,
        container!,
      ),
    );
    await settle();

    function dialogButton(label: string): HTMLButtonElement {
      const button = [...container!.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`missing button: ${label}`);
      return button;
    }

    const runButton = [...container!.querySelectorAll("button")].find(
      (button) => button.textContent === "Run retention redaction",
    )!;
    await act(() => runButton.click());
    expect(container.textContent).toContain("Run retention redaction for every currently eligible event and user?");

    // The confirm button stays disabled until the safety word is typed exactly.
    const confirmButton = dialogButton("Run retention redaction");
    expect(confirmButton.disabled).toBe(true);
    const typed = typedConfirmationInput(container)!;
    await act(() => {
      typed.value = "redact";
      typed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dialogButton("Run retention redaction").disabled).toBe(true);

    // Cancel: no run request is sent.
    await act(() => dialogButton("Cancel").click());
    await settle();
    expect(requests.some((r) => r.pathname === "/api/v1/retention/runs")).toBe(false);

    // Confirm with the exact typed word: the run executes.
    await act(() => runButton.click());
    const retryped = typedConfirmationInput(container)!;
    await act(() => {
      retryped.value = "REDACT";
      retryped.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => dialogButton("Run retention redaction").click());
    await settle();

    const runRequest = requests.find((r) => r.pathname === "/api/v1/retention/runs");
    expect(runRequest).toMatchObject({ method: "POST", body: { mode: "execute" } });
  });
});
