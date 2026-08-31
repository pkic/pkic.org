// @vitest-environment jsdom
/**
 * Retention redaction: the one operation on this surface that destroys data.
 *
 * It lives apart from the Operations read and command-visibility suites
 * because it is testing a different thing — the typed-confirmation gate in
 * front of an irreversible run — and because those suites are about what the
 * screen shows, while this is about what it refuses to do until asked twice.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduledWork } from "../../assets/ts/member-flows/portal/sections/system-operations/ScheduledWork";
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

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
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
