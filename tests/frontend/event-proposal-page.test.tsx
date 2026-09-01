// @vitest-environment jsdom
/**
 * The proposal submission form's validation gate, driven the way a browser
 * drives it.
 *
 * The module runs `main()` at import, so each case builds the shortcode's
 * markup, stubs the network, then imports it. What is asserted is the part the
 * design-system migration touched: the submit handler used to stamp
 * Bootstrap's `was-validated` on the form itself, a second owner for a state
 * `validateBeforeSubmit` already sets. Removing it must not weaken the gate,
 * so these cases pin that an incomplete form is still refused before the
 * network, that an unaccepted required term still marks itself invalid through
 * the platform's own `invalid` event, and that a complete form still submits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

import { proposalCreateSchema } from "../../assets/shared/schemas/proposal-management";

const PLACEMENTS = "/api/v1/events/pqc-2026/forms/placements/proposal_submission";
const PROPOSALS = "/api/v1/events/pqc-2026/proposals";

interface Captured {
  path: string;
  method: string;
  body: unknown;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** The placement projection the page builds its consents and types from. */
function placements(requiredTerms: unknown[] = []): Record<string, unknown> {
  return {
    event: { id: "20000000-0000-4000-8000-000000000001", slug: "pqc-2026", name: "PQC Conference 2026" },
    purpose: "proposal_submission",
    form: null,
    requiredTerms,
    allowedSessionTypes: ["talk"],
    eventDays: [],
  };
}

function term(): Record<string, unknown> {
  return {
    termKey: "speaker-agreement",
    version: "1",
    required: true,
    contentRef: null,
    displayText: "I accept the speaker agreement",
    helpText: null,
  };
}

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

/** The shortcode's markup, reduced to the parts the submit path reaches for. */
function mountShell(): HTMLFormElement {
  document.body.innerHTML = `
    <div class="event-flow pk"
      data-event-proposal
      data-event-slug="pqc-2026"
      data-api-base="/api/v1">
      <form novalidate>
        <input name="firstName" required>
        <input name="lastName" required>
        <input name="email" type="email" required>
        <input name="title" required>
        <textarea name="abstract" required></textarea>
        <div data-session-types></div>
        <div data-consents></div>
        <div data-custom-fields></div>
        <div data-proposal-speakers></div>
        <button type="submit">Submit proposal</button>
      </form>
      <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" hidden></p>
    </div>
  `;
  const form = document.querySelector("form");
  if (!form) throw new Error("shell did not mount");
  return form;
}

async function boot(): Promise<void> {
  await act(async () => {
    await import("../../assets/ts/event-flows/proposal-page");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fill(form: HTMLFormElement, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = value;
  }
}

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/2026/pqc-2026/propose/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("proposal submission gate", () => {
  it("refuses an incomplete proposal before it reaches the network", async () => {
    const form = mountShell();
    const requests = installApi({ [PLACEMENTS]: () => json(placements()) });

    await boot();
    await submit(form);

    expect(requests.some(({ method }) => method === "POST")).toBe(false);
  });

  it("marks an unaccepted required term invalid through the control, not a form-level class", async () => {
    const form = mountShell();
    installApi({ [PLACEMENTS]: () => json(placements([term()])) });

    await boot();
    fill(form, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      title: "Post-quantum migration",
      // The shared contract asks for at least eighty characters, so the
      // fixture satisfies the real rule rather than a sentence-long stand-in.
      abstract:
        "A walk through migrating a working certificate authority to post-quantum algorithms, with the rollbacks we needed.",
    });
    await submit(form);

    // The consent card learns it is invalid from the platform's own `invalid`
    // event, which `checkValidity()` fires — not from a class on the form.
    // Found by the hook the validator uses, not by a class: the class is the
    // legacy card's styling and no longer sits on this control.
    const consent = document.querySelector<HTMLInputElement>("input[data-consent-input]");
    expect(consent).not.toBeNull();
    expect(consent?.getAttribute("aria-invalid")).toBe("true");
    const field = consent?.closest(".pk-field");
    expect(field?.className).toContain("pk-field--invalid");
    const messageId = consent?.getAttribute("aria-describedby");
    expect(messageId).toBeTruthy();
    expect(document.querySelector(`[id="${messageId!.split(" ").at(-1)!}"]`)?.getAttribute("role")).toBe("alert");
  });

  it("submits a complete proposal through the shared create contract", async () => {
    const form = mountShell();
    const requests = installApi({
      [PLACEMENTS]: () => json(placements([term()])),
      [PROPOSALS]: () => json({ success: true, proposalId: "30000000-0000-4000-8000-000000000001" }),
    });

    await boot();
    fill(form, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      title: "Post-quantum migration",
      // The shared contract asks for at least eighty characters, so the
      // fixture satisfies the real rule rather than a sentence-long stand-in.
      abstract:
        "A walk through migrating a working certificate authority to post-quantum algorithms, with the rollbacks we needed.",
    });
    const consent = document.querySelector<HTMLInputElement>("input[data-consent-input]")!;
    await act(async () => {
      consent.checked = true;
      consent.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit(form);

    const posted = requests.find(({ method }) => method === "POST");
    expect(posted?.path).toBe(PROPOSALS);
    // Parsed through the shared request schema rather than compared literally,
    // so the case fails when the contract moves rather than agreeing with a
    // stale copy of it.
    const parsed = proposalCreateSchema.parse(posted?.body);
    expect(parsed.proposer.email).toBe("ada@example.test");
    expect(parsed.proposal.title).toBe("Post-quantum migration");
    expect(parsed.consents).toEqual([{ termKey: "speaker-agreement", version: "1" }]);
  });

  it("announces a failed placement load in the flow's live region", async () => {
    mountShell();
    installApi({ [PLACEMENTS]: () => json({ error: "unavailable" }, 503) });

    await boot();

    const status = document.querySelector<HTMLElement>("[data-flow-status]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.hidden).toBe(false);
    // The tone is in the data attribute as well as the styling, so failure is
    // not told apart from success by colour alone.
    expect(status?.dataset["state"]).toBe("error");
    expect(status?.textContent).toContain("Could not load proposal form details.");
  });
});
