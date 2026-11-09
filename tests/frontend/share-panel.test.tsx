// @vitest-environment jsdom
import { downloadFile } from "../../assets/ts/shared/download-file";
vi.mock("../../assets/ts/shared/download-file", () => ({ downloadFile: vi.fn() }));
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registrationInviteCreateSchema } from "../../assets/shared/schemas/registration";
import { renderSharePanel, refreshSharePanelBadge } from "../../assets/ts/shared/widgets/share-panel";
import { readResponse } from "./helpers/participant-registration-fixtures";
import { InviteColleagueDialog } from "../../assets/ts/components/event-invites/RegistrationInviteForm";
import { controlFor } from "./helpers/labeled-control";

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
function installApi(options: { rejects?: boolean; fieldError?: boolean } = {}): Captured[] {
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
      if (options.fieldError)
        return Promise.resolve(
          json(
            {
              error: {
                code: "VALIDATION",
                message: "Invalid request",
                details: {
                  fieldErrors: { "invites.0.email": ["Choose another recipient."] },
                },
              },
            },
            400,
          ),
        );
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

describe("capability invitation eligibility", () => {
  it.each(["pending_email_confirmation", "cancelled"] as const)(
    "keeps sharing but hides invitations for %s",
    (status) => {
      const panel = mount({ invitation: { status, startsAt: "2099-12-01T09:00:00.000Z" } });
      expect(panel.querySelector('input[type="email"]')).toBeNull();
      expect(panel.textContent).not.toContain("Invite colleagues by email");
      expect(panel.textContent).toContain("Share on LinkedIn");
    },
  );
  it.each(["registered", "pending_email_confirmation"] as const)(
    "loads %s eligibility on a confirmation share panel",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            json(
              readResponse({
                registration: { ...readResponse().registration, status },
                event: { id: "event-1", slug: "pki-summit", name: "PKI Summit", startsAt: "2099-12-01T09:00:00.000Z" },
              }),
            ),
          ),
        ),
      );
      const panel = mount({ invitation: undefined });
      expect(panel.textContent).not.toContain("Invite colleagues by email");
      await settle();
      expect(panel.textContent?.includes("Invite colleagues by email")).toBe(status === "registered");
      expect(panel.textContent).toContain("Share on LinkedIn");
    },
  );
  it("hides capability invitations when the open page reaches the start", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime("2026-12-01T08:59:59.000Z");
      const panel = mount({ invitation: { status: "registered", startsAt: "2026-12-01T09:00:00.000Z" } });
      expect(panel.textContent).toContain("Invite colleagues by email");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_251);
      });
      expect(panel.textContent).not.toContain("Invite colleagues by email");
      expect(panel.textContent).toContain("Share on LinkedIn");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("share panel copy", () => {
  it("names sharing independently of whether email invitations are available", () => {
    for (const options of [{ waitlisted: true }, { manageToken: null, eventSlug: null }, {}]) {
      const panel = mount(options);
      expect(panel.querySelector("h3")?.textContent).toBe("Share this event");
      expect(panel.textContent).not.toContain("seats are limited");
      expect(panel.textContent).toContain("Share on LinkedIn");
    }
  });
});

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
      invitation: { status: "registered", startsAt: "2099-12-01T09:00:00.000Z" },
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

function labeledInput(container: HTMLElement, label: string): HTMLInputElement {
  return controlFor(container, label);
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

it("ignores blank invite rows and maps a nonblank row's validation to its controls", async () => {
  const requests = installApi();
  const container = mount();
  await click(button(container, "Invite by email"));
  await click(button(container, "Add row"));
  await typeInto(labeledInput(container, "Invite 2 first name (optional)"), "Alice");
  await click(button(container, "Send invites"));
  expect(labeledInput(container, "Invite 2 email address").getAttribute("aria-invalid")).toBe("true");
  expect(labeledInput(container, "Invite 1 email address").getAttribute("aria-invalid")).not.toBe("true");
  expect(requests).toHaveLength(0);
  await typeInto(labeledInput(container, "Invite 2 email address"), "alice@example.com");
  await click(button(container, "Send invites"));
  expect(registrationInviteCreateSchema.parse(requests[0]?.body).invites).toEqual([
    { email: "alice@example.com", firstName: "Alice" },
  ]);
});

it("keeps touched fields on their invitation row when an earlier blank row is filled", async () => {
  installApi();
  const container = mount();
  await click(button(container, "Invite by email"));
  await click(button(container, "Add row"));
  await typeInto(labeledInput(container, "Invite 2 email address"), "invalid");
  const first = labeledInput(container, "Invite 1 email address");
  const second = labeledInput(container, "Invite 2 email address");
  const names = [first.name, second.name];
  expect(second.getAttribute("aria-invalid")).toBe("true");
  await typeInto(labeledInput(container, "Invite 1 first name (optional)"), "Casey");
  expect([first.name, second.name]).toEqual(names);
  expect(first.getAttribute("aria-invalid")).not.toBe("true");
  expect(second.getAttribute("aria-invalid")).toBe("true");
});

it("keeps a server refusal on its invitation when earlier rows change or are removed", async () => {
  const requests = installApi({ fieldError: true });
  const container = mount();
  await click(button(container, "Invite by email"));
  await click(button(container, "Add row"));
  await typeInto(labeledInput(container, "Invite 2 email address"), "alice@example.com");
  await click(button(container, "Send invites"));
  expect(registrationInviteCreateSchema.parse(requests[0]?.body).invites).toHaveLength(1);
  const second = labeledInput(container, "Invite 2 email address");
  expect(second.closest(".pk-field")?.textContent).toContain("Choose another recipient.");
  await typeInto(labeledInput(container, "Invite 1 first name (optional)"), "Casey");
  expect(labeledInput(container, "Invite 1 email address").closest(".pk-field")?.textContent).not.toContain(
    "Choose another recipient.",
  );
  expect(second.closest(".pk-field")?.textContent).toContain("Choose another recipient.");
  await click(container.querySelector<HTMLButtonElement>('[aria-label="Remove invite 1"]')!);
  expect(labeledInput(container, "Invite 1 email address").value).toBe("alice@example.com");
  expect(labeledInput(container, "Invite 1 email address").closest(".pk-field")?.textContent).toContain(
    "Choose another recipient.",
  );
});

describe("colleague invitation dialog", () => {
  it("reuses the invitation form, validates before sending, and queues only on explicit send", async () => {
    const requests = installApi();
    const closed = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<InviteColleagueDialog eventSlug="pki-summit" onClose={closed} />, container));
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("form")?.noValidate).toBe(true);
    expect(requests).toHaveLength(0);
    await click(button(dialog, "Send invites"));
    expect(requests).toHaveLength(0);
    expect(labeledInput(dialog, "Invite 1 email address").getAttribute("aria-invalid")).toBe("true");
    await typeInto(labeledInput(dialog, "Invite 1 first name (optional)"), "Alice");
    await typeInto(labeledInput(dialog, "Invite 1 email address"), "alice@example.com");
    await click(button(dialog, "Send invites"));
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBeNull();
    expect(registrationInviteCreateSchema.parse(requests[0].body).invites).toEqual([
      { firstName: "Alice", email: "alice@example.com" },
    ]);
    expect(dialog.textContent).toContain("Queued 1 invitation.");
    await click(button(dialog, "Done"));
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe("share panel", () => {
  it("names the referral link through a label, and every invite control through its position", () => {
    const container = mount();

    // Resolved through the `for`/`id` pair itself, so the lookup fails exactly
    // when the labeling contract is broken.
    const link = controlFor(container, "Your unique sharing link");
    expect(link.value).toBe(SHARE_URL);
    expect(link.readOnly).toBe(true);

    const toggle = button(container, "Invite by email");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const fields = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(fields).not.toBeNull();
    expect(fields?.hidden).toBe(true);

    expect(labeledInput(container, "Invite 1 email address")).toBeTruthy();
    expect(labeledInput(container, "Invite 1 first name (optional)")).toBeTruthy();

    // The badge is decorative-looking but carries the registrant's name, so it
    // is described rather than hidden.
    const badge = container.querySelector<HTMLImageElement>("[data-og-badge-img]");
    expect(badge?.alt).toBe("Your personal invite badge for PKI Summit");
  });

  it("keeps the shared download control busy until the square image arrives, then saves it", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(
      (_input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const container = mount();
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Download badge formats"]')!);
    const square = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Square badge"),
    )!;
    await click(square);
    const main = container.querySelector<HTMLButtonElement>('button[aria-label="Download badge (PNG)"]')!;
    expect(main.getAttribute("aria-busy")).toBe("true");
    expect(main.querySelector(".pk-btn__spinner")).not.toBeNull();
    await click(main);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("format")).toBe("square");
    expect(url.pathname).toContain("/referrals/AbC123/badge");
    const image = new Response(null, { headers: { "content-type": "image/png" } });
    // jsdom's Blob is the browser contract; Node's Response.blob() produces
    // a different constructor even though the data is otherwise identical.
    vi.spyOn(image, "blob").mockResolvedValue(new Blob(["synthetic image"], { type: "image/png" }));
    await act(async () => finish(image));
    await vi.waitFor(() => {
      expect(main.hasAttribute("aria-busy")).toBe(false);
      expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), "image/png", expect.stringMatching(/-square\.png$/u));
    });
  });

  it("shows a download refusal and leaves the control available to retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FAILED", message: "Could not generate your badge. Try again." } }, 503)),
    );
    const container = mount();
    const main = container.querySelector<HTMLButtonElement>('button[aria-label="Download badge (PNG)"]')!;
    await click(main);
    await settle();
    expect(container.querySelector(".pk-alert--danger")?.textContent).toContain("Could not generate your badge");
    expect(main.hasAttribute("aria-busy")).toBe(false);
  });

  it("sends invites the shared request contract accepts", async () => {
    const requests = installApi();
    const container = mount();

    await click(button(container, "Invite by email"));
    await typeInto(labeledInput(container, "Invite 1 first name (optional)"), "Alice");
    await typeInto(labeledInput(container, "Invite 1 email address"), "alice@example.com");
    await click(button(container, "Send invites"));

    const sent = requests.find((request) => request.path === INVITES_PATH);
    expect(sent?.method).toBe("POST");
    expect(sent?.authorization).toBe("Bearer manage-token");
    // Parsing proves the backend would accept it; a literal comparison would
    // only prove the panel sends what the panel sends.
    const body = registrationInviteCreateSchema.parse(sent?.body);
    expect(body.invites).toEqual([{ email: "alice@example.com", firstName: "Alice" }]);

    const announced = Array.from(container.querySelectorAll('[role="status"], [role="alert"]'));
    expect(announced.some((node) => node.textContent === "Queued 1 invitation.")).toBe(true);
  });

  it("reports a rejected send in an alert and keeps the typed rows", async () => {
    installApi({ rejects: true });
    const container = mount();

    await click(button(container, "Invite by email"));
    await typeInto(labeledInput(container, "Invite 1 email address"), "alice@example.com");
    await click(button(container, "Send invites"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("You have used this event's invite quota.");
    // A failed send must not clear what the reader typed.
    expect(labeledInput(container, "Invite 1 email address").value).toBe("alice@example.com");
  });

  it("refuses to send when no row holds an address, and never reaches the network", async () => {
    const requests = installApi();
    const container = mount();

    await click(button(container, "Invite by email"));
    await click(button(container, "Send invites"));

    expect(labeledInput(container, "Invite 1 email address").getAttribute("aria-invalid")).toBe("true");
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
    // The indicator is a status region, not a colored shape.
    expect(loader!.querySelector('[role="status"]')?.textContent).toContain("Generating your badge…");

    image!.dispatchEvent(new Event("error"));
    expect(loader!.hidden).toBe(true);
  });
});
