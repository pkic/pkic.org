// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registrationInviteCreateSchema } from "../../assets/shared/schemas/registration";
import { renderSharePanel, refreshSharePanelBadge } from "../../assets/ts/shared/widgets/share-panel";
import { controlFor } from "./helpers/labelled-control";

const SHARE_URL = "https://pkic.test/r/AbC123";
const INVITES_PATH = "/api/v1/events/pki-summit/invites";

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

interface Captured {
  path: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/**
 * `rejects` makes the invite endpoint answer with the API's error envelope,
 * which is the only way to reach the panel's failure path: it surfaces
 * whatever the client threw rather than a message of its own.
 */
function installApi(options: { rejects?: boolean } = {}): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const headers = new Headers(init.headers);
      requests.push({
        path: url.pathname,
        method: init.method ?? "GET",
        authorization: headers.get("authorization"),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (url.pathname !== INVITES_PATH) throw new Error(`Unexpected request: ${url.pathname}`);
      if (options.rejects) {
        return Promise.resolve(
          json({ error: { code: "RATE_LIMITED", message: "You have used this event's invite quota." } }, 429),
        );
      }
      return Promise.resolve(
        json({ success: true, created: [{ email: "alice@example.com" }], endorsed: [], skipped: [] }),
      );
    }),
  );
  return requests;
}

function mount(options: Partial<Parameters<typeof renderSharePanel>[1]> = {}): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() =>
    renderSharePanel(container, {
      shareUrl: SHARE_URL,
      eventName: "PKI Summit",
      firstName: "Ada",
      lastName: "Lovelace",
      manageToken: "manage-token",
      eventSlug: "pki-summit",
      ...options,
    }),
  );
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((candidate) =>
    (candidate.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`No button reading "${text}"`);
  return found;
}

function labelledInput(container: HTMLElement, ariaLabel: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`[aria-label="${ariaLabel}"]`);
  if (!input) throw new Error(`No control named "${ariaLabel}"`);
  return input;
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function typeInto(field: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("share panel", () => {
  it("names the referral link through a label, and every invite control through its position", () => {
    const container = mount();

    // Resolved through the `for`/`id` pair itself, so the lookup fails exactly
    // when the labelling contract is broken.
    const link = controlFor(container, "Your unique sharing link");
    expect(link.value).toBe(SHARE_URL);
    expect(link.readOnly).toBe(true);

    const toggle = button(container, "Invite by email");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const fields = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(fields).not.toBeNull();
    expect(fields?.hidden).toBe(true);

    expect(labelledInput(container, "Invite 1 email address")).toBeTruthy();
    expect(labelledInput(container, "Invite 1 first name (optional)")).toBeTruthy();

    // The badge is decorative-looking but carries the registrant's name, so it
    // is described rather than hidden.
    const badge = container.querySelector<HTMLImageElement>("[data-og-badge-img]");
    expect(badge?.alt).toBe("Your personal invite badge for PKI Summit");
  });

  it("sends invites the shared request contract accepts", async () => {
    const requests = installApi();
    const container = mount();

    await click(button(container, "Invite by email"));
    await typeInto(labelledInput(container, "Invite 1 first name (optional)"), "Alice");
    await typeInto(labelledInput(container, "Invite 1 email address"), "alice@example.com");
    await click(button(container, "Send invites"));

    const sent = requests.find((request) => request.path === INVITES_PATH);
    expect(sent?.method).toBe("POST");
    expect(sent?.authorization).toBe("Bearer manage-token");
    // Parsing proves the backend would accept it; a literal comparison would
    // only prove the panel sends what the panel sends.
    const body = registrationInviteCreateSchema.parse(sent?.body);
    expect(body.invites).toEqual([{ email: "alice@example.com", firstName: "Alice" }]);

    const announced = Array.from(container.querySelectorAll('[role="status"], [role="alert"]'));
    expect(
      announced.some((node) => node.textContent === "Sent 1 invitation. They'll receive a registration link shortly."),
    ).toBe(true);
  });

  it("reports a rejected send in an alert and keeps the typed rows", async () => {
    installApi({ rejects: true });
    const container = mount();

    await click(button(container, "Invite by email"));
    await typeInto(labelledInput(container, "Invite 1 email address"), "alice@example.com");
    await click(button(container, "Send invites"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("You have used this event's invite quota.");
    // A failed send must not clear what the reader typed.
    expect(labelledInput(container, "Invite 1 email address").value).toBe("alice@example.com");
  });

  it("refuses to send when no row holds an address, and never reaches the network", async () => {
    const requests = installApi();
    const container = mount();

    await click(button(container, "Invite by email"));
    await click(button(container, "Send invites"));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Please enter at least one email address.");
    expect(requests).toHaveLength(0);
  });

  it("announces a refused clipboard rather than leaving the reader with nothing", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const container = mount();

    await click(button(container, "Copy link"));

    const live = Array.from(container.querySelectorAll('[role="status"]'));
    expect(live.some((node) => (node.textContent ?? "").includes("Could not copy automatically"))).toBe(true);
    // The button keeps its name: renaming a control mid-interaction moves the
    // goalposts for anyone reading it.
    expect(button(container, "Copy link").textContent).toBe("Copy link");
  });

  it("omits the invite form when the panel has no manage capability", () => {
    const container = mount({ manageToken: null, eventSlug: null });

    expect(container.querySelector('[aria-label="Invite 1 email address"]')).toBeNull();
    expect(container.textContent).toContain("Share on LinkedIn");
  });

  it("re-shows the badge indicator while a regenerated image loads", () => {
    const container = mount();
    const loader = container.querySelector<HTMLElement>("[data-og-badge-loading]");
    const image = container.querySelector<HTMLImageElement>("[data-og-badge-img]");
    expect(loader).not.toBeNull();
    expect(image).not.toBeNull();

    loader!.hidden = true;
    refreshSharePanelBadge(container);

    expect(loader!.hidden).toBe(false);
    expect(image!.src).toContain("?t=");
    // The indicator is a status region, not a coloured shape.
    expect(loader!.querySelector('[role="status"]')?.textContent).toContain("Generating your badge…");

    image!.dispatchEvent(new Event("error"));
    expect(loader!.hidden).toBe(true);
  });
});
