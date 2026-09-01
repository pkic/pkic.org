// @vitest-environment jsdom
/**
 * The confirmation shell, driven the way a browser drives it.
 *
 * The module runs `main()` at import, so each case builds the shortcode's
 * markup, stubs the network, then imports it. What is asserted is mostly what
 * the surface exposes rather than how it is painted: the `for`/`id` pair that
 * names the recovery control, `aria-invalid` and `aria-describedby` when the
 * address is missing, the live regions that carry the outcome, and the fact
 * that the resend button's name does not move between states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { registrationResendConfirmationSchema } from "../../assets/shared/schemas/registration";
import { controlFor } from "./helpers/labelled-control";

const CONFIRM_INFO = "/api/v1/events/pqc-2026/registrations/confirm-info";
const RESEND = "/api/v1/events/pqc-2026/registrations/resend-confirmation";

interface Captured {
  path: string;
  method: string;
  body: unknown;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** The read-only projection the page personalises itself from. */
function confirmInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: null,
    lastName: null,
    email: null,
    organizationName: null,
    eventName: "PQC Conference 2026",
    expired: false,
    recoverable: false,
    ...overrides,
  };
}

/**
 * Stubs fetch and records every request. Unmatched paths answer with an empty
 * object rather than throwing: the success panel embeds the donation widget,
 * which reaches for geolocation, and that is not what these cases are about.
 */
function installApi(routes: Record<string, () => Response>): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), location.origin);
      requests.push({
        path: url.pathname,
        method: (init.method ?? "GET").toUpperCase(),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const route = routes[url.pathname];
      return Promise.resolve(route ? route() : json({}));
    }),
  );
  return requests;
}

function mountShell(): HTMLElement {
  document.body.innerHTML = `
    <div class="event-flow"
      data-event-registration-confirm
      data-event-slug="pqc-2026"
      data-api-base="/api/v1">
      <div data-confirm-loading></div>
      <div data-confirm-content hidden>
        <form novalidate><button type="submit">Confirm my registration</button></form>
      </div>
      <p data-flow-status class="alert visually-hidden" role="status" aria-live="polite" hidden></p>
    </div>
  `;
  const root = document.querySelector<HTMLElement>("[data-event-registration-confirm]");
  if (!root) throw new Error("shell did not mount");
  return root;
}

/** Imports the module under test and lets its promise chain settle. */
async function boot(): Promise<void> {
  await act(async () => {
    await import("../../assets/ts/event-flows/registration-confirm-page");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const match = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!match) throw new Error(`no button reads "${name}"`);
  return match;
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("registration confirmation shell", () => {
  it("reports a missing token in the flow's live region and never reaches the network", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/");
    const root = mountShell();
    const requests = installApi({});

    await boot();

    const status = root.querySelector<HTMLElement>("[data-flow-status]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain("Missing confirmation token");
    // The tone is carried in the data attribute as well as the styling, so a
    // reader is not asked to tell success from failure by colour.
    expect(status?.dataset["state"]).toBe("error");
    expect(requests).toHaveLength(0);
    // Nothing was revealed, so the reader is not left with a dead form.
    expect(root.querySelector<HTMLElement>("[data-confirm-content]")?.hidden).toBe(true);
  });

  it("reveals the confirm form once the personalisation fetch lands", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=live-token");
    const root = mountShell();
    installApi({ [CONFIRM_INFO]: () => json(confirmInfo({ firstName: "Ada" })) });

    await boot();

    expect(root.querySelector<HTMLElement>("[data-confirm-loading]")?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-confirm-content]")?.hidden).toBe(false);
  });

  it("names the recovery control through a label, and marks it invalid when it is empty", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=stale-token");
    const root = mountShell();
    const requests = installApi({ [CONFIRM_INFO]: () => json(confirmInfo({ expired: true })) });

    await boot();

    // Resolved through the `for`/`id` pair itself, so the lookup fails exactly
    // when the labelling contract is broken.
    const control = controlFor(root, "Email address");
    expect(control.type).toBe("email");
    expect(control.required).toBe(true);
    expect(control.getAttribute("aria-invalid")).toBe(null);

    await act(async () => {
      root.querySelector("form:not([novalidate])")?.dispatchEvent(new Event("submit", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(control.getAttribute("aria-invalid")).toBe("true");
    const messageId = control.getAttribute("aria-describedby");
    expect(messageId).toBeTruthy();
    const message = root.querySelector(`#${messageId ?? ""}`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("Enter the email address you used for registration.");
    // A refusal the surface can decide on its own must not cost a request.
    expect(requests.some((request) => request.path === RESEND)).toBe(false);
  });

  it("sends a resend request the shared contract accepts, and confirms it in a live region", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=stale-token");
    const root = mountShell();
    const requests = installApi({
      [CONFIRM_INFO]: () => json(confirmInfo({ expired: true })),
      [RESEND]: () => json({ ok: true }),
    });

    await boot();

    const control = controlFor(root, "Email address");
    control.value = "ada@example.com";
    await act(async () => {
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(buttonNamed(root, "Send me a new link"));

    const resend = requests.find((request) => request.path === RESEND);
    expect(resend?.method).toBe("POST");
    // Parsing proves the backend would accept it; a literal comparison would
    // only prove the page sends what the page sends.
    const body = registrationResendConfirmationSchema.parse(resend?.body);
    expect(body.email).toBe("ada@example.com");
    expect(body.token).toBe("stale-token");

    const outcome = [...root.querySelectorAll<HTMLElement>("[role='status']")].find((el) =>
      el.textContent?.includes("A new confirmation link is on its way"),
    );
    expect(outcome).toBeTruthy();
  });

  it("announces a refused resend without renaming the control the reader is on", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=stale-token");
    const root = mountShell();
    installApi({
      [CONFIRM_INFO]: () => json(confirmInfo({ expired: true })),
      [RESEND]: () => json({ error: { code: "RATE_LIMITED", message: "Too many requests — try again shortly." } }, 429),
    });

    await boot();

    const control = controlFor(root, "Email address");
    control.value = "ada@example.com";
    await act(async () => {
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(buttonNamed(root, "Send me a new link"));

    const alert = [...root.querySelectorAll<HTMLElement>("[role='alert']")].find((el) =>
      el.textContent?.includes("Too many requests"),
    );
    expect(alert).toBeTruthy();
    // The failure lives beside the control, not in the page-level banner at
    // the foot of the flow.
    expect(root.querySelector<HTMLElement>("[data-flow-status]")?.hidden).toBe(true);
    // Relabelling the button mid-interaction would move its accessible name
    // under the reader's cursor, so the name has to survive the failure.
    expect(buttonNamed(root, "Send me a new link").disabled).toBe(false);
  });

  it("auto-sends when the address is already known, and says so", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=stale-token");
    const root = mountShell();
    const requests = installApi({
      [CONFIRM_INFO]: () => json(confirmInfo({ expired: true, email: "grace@example.com", firstName: "Grace" })),
      [RESEND]: () => json({ ok: true }),
    });

    await boot();
    await settle();

    const resend = requests.find((request) => request.path === RESEND);
    const body = registrationResendConfirmationSchema.parse(resend?.body);
    expect(body.email).toBe("grace@example.com");
    // No address to ask for, so no field is rendered.
    expect(() => controlFor(root, "Email address")).toThrow();
    expect(root.textContent).toContain("A new confirmation link is on its way");
  });

  it("replaces the form with a named success region and its next steps", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=live-token");
    const root = mountShell();
    installApi({
      [CONFIRM_INFO]: () => json(confirmInfo({ firstName: "Ada" })),
      "/api/v1/events/pqc-2026/registrations/confirm-email": () =>
        json({
          success: true,
          stage: "confirmed",
          status: "registered",
          shareUrl: null,
          dayAttendance: [],
          dayWaitlist: [],
          manageUrl: "https://pkic.org/events/2026/pqc-2026/register/manage/?token=manage-token-0123456789",
          manageToken: "manage-token-0123456789",
        }),
    });

    await boot();

    const form = root.querySelector<HTMLFormElement>("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    // The panel appears in place of the form the reader just submitted, so it
    // is a state change and has to be announced as one.
    const panel = [...root.querySelectorAll<HTMLElement>("[role='status']")].find((el) =>
      el.textContent?.includes("you're registered"),
    );
    expect(panel).toBeTruthy();
    expect(form?.hidden).toBe(true);

    // "Next steps" is a real heading rather than a bold paragraph, so it is
    // reachable from a heading list.
    const heading = [...root.querySelectorAll("h1, h2, h3, h4")].map((el) => el.textContent);
    expect(heading).toContain("Next steps");
    const manage = [...root.querySelectorAll("a")].find((link) => link.textContent === "Manage registration");
    expect(manage?.getAttribute("href")).toContain("/register/manage/");
  });

  it("falls back to the resend panel when the server rejects the token at submit time", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=live-token");
    const root = mountShell();
    installApi({
      [CONFIRM_INFO]: () => json(confirmInfo({ firstName: "Ada" })),
      "/api/v1/events/pqc-2026/registrations/confirm-email": () =>
        json({ error: { code: "CONFIRM_TOKEN_EXPIRED", message: "That link has expired." } }, 410),
    });

    await boot();

    const form = root.querySelector<HTMLFormElement>("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(form?.hidden).toBe(true);
    expect(controlFor(root, "Email address").type).toBe("email");
    // A recoverable token is not a page-level failure, so the flow banner is
    // left alone rather than shouting an error the panel already handles.
    expect(root.querySelector<HTMLElement>("[data-flow-status]")?.hidden).toBe(true);
  });

  it("puts an unrecognised submit failure in the flow's live region", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/register/confirm/?token=live-token");
    const root = mountShell();
    installApi({
      [CONFIRM_INFO]: () => json(confirmInfo({ firstName: "Ada" })),
      "/api/v1/events/pqc-2026/registrations/confirm-email": () =>
        json({ error: { code: "SERVER_ERROR", message: "Something went wrong." } }, 500),
    });

    await boot();

    await act(async () => {
      root.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const status = root.querySelector<HTMLElement>("[data-flow-status]");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe("Something went wrong.");
    expect(status?.dataset["state"]).toBe("error");
  });
});
