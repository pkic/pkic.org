// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventBulkAttendeeInvitesPreviewSchema,
  eventBulkAttendeeInvitesSchema,
} from "../../assets/shared/schemas/event-invite-bulk";
import { BulkInviteComposer, eventInviteEndpoints } from "../../assets/ts/components/event-invites/BulkInviteComposer";
import type { ToastType } from "../../assets/ts/shared/ui";

const BASE = "/api/v1/groups/g1/events/architecture-workshop/invitations";
const ENDPOINTS = eventInviteEndpoints(BASE, "attendee");
const EVENT = { endsAt: "2026-09-01T16:00:00.000Z", timezone: "Europe/Amsterdam" };

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function previewResponse() {
  return {
    success: true,
    subject: "You are invited to the Architecture workshop",
    html: "<p>Hello</p>",
    text: "Hello",
    previewToken: "preview-token-that-is-long-enough",
    inviteDigest: "a".repeat(64),
    inviteExpiresAt: "2026-09-01T15:00:00.000Z",
    previewExpiresAt: "2026-09-01T12:00:00.000Z",
    recipientCount: 1,
    sendBatches: [
      { offset: 0, count: 1, previewToken: "preview-token-that-is-long-enough", inviteDigest: "a".repeat(64) },
    ],
  };
}

interface Captured {
  path: string;
  method: string;
  body: unknown;
}

/**
 * `previewFails` makes the preview endpoint answer with the API's error
 * envelope, which is the only way to reach the composer's failure path: the
 * component surfaces whatever the client threw rather than a message of its
 * own.
 */
function installApi(options: { previewFails?: boolean } = {}): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      requests.push({
        path: url.pathname,
        method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.pathname === ENDPOINTS.preview) {
        if (options.previewFails) {
          return Promise.resolve(
            json({ error: { code: "VALIDATION_ERROR", message: "Three addresses already have invitations." } }, 422),
          );
        }
        return Promise.resolve(json(previewResponse()));
      }
      if (url.pathname === ENDPOINTS.bulk) {
        return Promise.resolve(
          json({ success: true, created: [{ email: "alice@example.com" }], endorsed: [], skipped: [] }),
        );
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

function mount(notify: (message: string, type: ToastType) => void, onSent?: () => void): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() =>
    render(
      <BulkInviteComposer type="attendee" endpoints={ENDPOINTS} event={EVENT} notify={notify} onSent={onSent} />,
      container,
    ),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!found) throw new Error(`No button labelled "${text}"`);
  return found;
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function emailInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="attendee 1 email address"]');
  if (!input) throw new Error("No email input");
  return input;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("bulk invite composer", () => {
  it("previews and sends invites the bulk-invite request contracts accept", async () => {
    const requests = installApi();
    const sent = vi.fn();
    const container = mount(vi.fn(), sent);

    await typeInto(emailInput(container), "alice@example.com");
    await click(button(container, "Preview email"));

    const preview = requests.find((request) => request.path === ENDPOINTS.preview);
    expect(preview?.method).toBe("POST");
    // Parsing proves the backend would accept it; a literal comparison would
    // only prove the component sends what the component sends.
    const previewBody = eventBulkAttendeeInvitesPreviewSchema.parse(preview?.body);
    expect(previewBody.invites).toEqual([{ email: "alice@example.com" }]);

    const confirm = container.querySelector<HTMLInputElement>("#invite-confirm-attendee");
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm?.click();
    });
    await click(button(container, "Send attendee invites"));

    const bulk = requests.find((request) => request.path === ENDPOINTS.bulk);
    const bulkBody = eventBulkAttendeeInvitesSchema.parse(bulk?.body);
    expect(bulkBody.previewToken).toBe("preview-token-that-is-long-enough");
    expect(bulkBody.invites).toHaveLength(1);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Sent 1 invites");
  });

  it("reports a rejected preview in its live region and sends nothing", async () => {
    const requests = installApi({ previewFails: true });
    const notify = vi.fn();
    const container = mount(notify);

    await typeInto(emailInput(container), "alice@example.com");
    await click(button(container, "Preview email"));

    expect(notify).toHaveBeenCalledWith("Three addresses already have invitations.", "error");
    const live = Array.from(container.querySelectorAll('[role="status"]'));
    expect(live.some((node) => node.textContent === "Three addresses already have invitations.")).toBe(true);
    // The failure must leave the surface unable to send: no preview, so no
    // confirmation checkbox, and the send button stays inert.
    expect(container.querySelector("#invite-confirm-attendee")).toBeNull();
    expect(button(container, "Send attendee invites").disabled).toBe(true);
    expect(requests.some((request) => request.path === ENDPOINTS.bulk)).toBe(false);
  });

  it("refuses to preview when no row holds a usable address", async () => {
    const requests = installApi();
    const notify = vi.fn();
    const container = mount(notify);

    await typeInto(emailInput(container), "not-an-address");
    await click(button(container, "Preview email"));

    expect(notify).toHaveBeenCalledWith("No valid emails to preview", "error");
    expect(requests).toHaveLength(0);
  });

  it("labels every control it exposes to assistive technology", async () => {
    installApi();
    const container = mount(vi.fn());

    // The pasted-contacts textarea and the deadline input are both labelled
    // through a real for/id pair rather than a placeholder.
    const labels = Array.from(container.querySelectorAll("label"));
    const pasteLabel = labels.find((label) => label.textContent?.trim() === "Paste emails and names");
    expect(pasteLabel?.htmlFor).toBeTruthy();
    const paste = container.querySelector<HTMLTextAreaElement>(`[id="${pasteLabel?.htmlFor ?? ""}"]`);
    expect(paste?.tagName).toBe("TEXTAREA");
    expect(paste?.getAttribute("aria-describedby")).toBeTruthy();
    expect(container.querySelector(`[id="${paste?.getAttribute("aria-describedby") ?? ""}"]`)?.textContent).toContain(
      "One address per line",
    );

    // The row's remove control is icon-only, so its name has to come from
    // aria-label — and has to say which row it removes.
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove attendee 1"]');
    expect(remove).not.toBeNull();

    // The confirmation checkbox is drawn by the design system, which needs all
    // three parts; only the first would render an operating-system control.
    await typeInto(emailInput(container), "alice@example.com");
    await click(button(container, "Preview email"));
    const confirm = container.querySelector<HTMLInputElement>("#invite-confirm-attendee");
    expect(confirm?.classList.contains("pk-check__input")).toBe(true);
    expect(confirm?.parentElement?.classList.contains("pk-check")).toBe(true);
    expect(confirm?.closest("label")?.querySelector(".pk-check__label")?.textContent).toBe(
      "I reviewed this preview and confirm sending this email.",
    );

    // The preview is untrusted author HTML and must stay fully sandboxed.
    const frame = container.querySelector<HTMLIFrameElement>("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.title).toBe("attendee invitation preview");
  });
});
