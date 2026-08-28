// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DueWork } from "../../assets/ts/admin/sections/DueWork";

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

const emptyJobResult = {
  success: true,
  dryRun: true,
  reminders: {
    processed: 0,
    inviteRemindersQueued: 0,
    speakerInviteRemindersQueued: 0,
    presentationRemindersQueued: 0,
    confirmationRemindersQueued: 0,
    confirmationCancellationsProcessed: 0,
    preview: {
      attendeeInvites: [],
      speakerInvites: [],
      coSpeakerInvites: [],
      presentationUploads: [],
      registrationConfirmations: [],
    },
  },
  shouldRunRetention: false,
  retention: {
    redactedRegistrations: 0,
    redactedUsers: 0,
    affectedEvents: 0,
    preview: { dueEvents: [], totalEvents: 0, totalRegistrations: 0, totalUsers: 0 },
  },
  outbox: { processed: 0, failed: 0, dueNow: 0, dueByStatus: {}, nextSendAfter: null },
  consultationBatch: { applicationsNotified: 0 },
  ecReviewBatch: { transitioned: 0 },
  wgChairDigest: { workingGroupsWithChanges: 0, emailsSent: 0 },
};

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("admin due-work commands", () => {
  it("loads only the bounded GET projection until an operator explicitly requests a dry-run preview", async () => {
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
        if (url.pathname === "/api/v1/admin/due-work") {
          return json({
            items: [],
            counts: { all: 0, outbox: 0, reminders: 0, cleanup: 0 },
            page: { limit: 25, offset: 0, total: 0, hasMore: false },
          });
        }
        if (url.pathname === "/api/v1/internal/jobs/run" && method === "POST") {
          return json({ ...emptyJobResult, dryRun: Boolean((body as { dryRun?: boolean } | null)?.dryRun) });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<DueWork />, container!));
    await settle();

    expect(requests.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual(["GET /api/v1/admin/due-work"]);
    expect(container.textContent).toContain("Detailed job output is loaded only when you request a dry-run preview");

    const previewButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Refresh Preview",
    )!;
    await act(async () => {
      previewButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const commandRequests = requests.filter(({ url }) => url.pathname === "/api/v1/internal/jobs/run");
    expect(commandRequests).toHaveLength(1);
    expect(commandRequests[0]).toMatchObject({ method: "POST", body: { dryRun: true } });
    expect(container.textContent).toContain("Preview (Dry Run)");

    const runButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Process Due Work Now",
    )!;
    await act(async () => {
      runButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(requests.filter(({ url }) => url.pathname === "/api/v1/internal/jobs/run")).toHaveLength(2);
    expect(requests.filter(({ url }) => url.pathname === "/api/v1/admin/due-work")).toHaveLength(2);
    expect(container.textContent).toContain("Last Run");
  });
});
