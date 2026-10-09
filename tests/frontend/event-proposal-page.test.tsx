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
import { renderToString } from "preact-render-to-string";
import { EventProposalForm } from "../../assets/ts/site/EventProposalForm";
import { eventProposalProofVerifySchema } from "../../assets/shared/schemas/event-proposal-proof";

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
    registrationPolicy: "public",
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
  document.body.innerHTML = renderToString(<EventProposalForm />);
  document.querySelector<HTMLElement>("[data-event-proposal]")!.dataset.eventSlug = "pqc-2026";
  const form = document.querySelector("form");
  if (!form) throw new Error("shell did not mount");
  return form;
}

async function boot(): Promise<void> {
  await act(async () => {
    await import("../../assets/ts/event-flows/proposal-page");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => {
    expect(
      !document.querySelector("[data-consents]")?.textContent?.includes("Loading") ||
        document.querySelector<HTMLElement>("[data-flow-status]")?.dataset.state === "error",
    ).toBe(true);
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
    const messageId = consent?.getAttribute("aria-describedby");
    expect(messageId).toBeTruthy();
    expect(document.querySelector(`[id="${messageId!.split(" ").at(-1)!}"]`)?.getAttribute("role")).toBe("alert");
  });

  it("reuses verified personal details without serializing duplicate personal fields", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/propose/#verify=" + "v".repeat(40));
    const form = mountShell();
    const requests = installApi({
      [PLACEMENTS]: () => json(placements([term()])),
      [PROPOSALS + "/proof/verify"]: () =>
        json({
          status: "ready",
          continuationToken: "c".repeat(40),
          entryContext: {
            inviteToken: "refreshed-invitation-capability",
            inviteId: "40000000-0000-4000-8000-000000000001",
            sourceType: "invite",
            sourceRef: "invite",
            referralCode: "ABC12345",
          },
          applicantKind: "individual",
          email: "ada@example.test",
          organization: null,
          person: {
            email: "ada@example.test",
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
        }),
      [PROPOSALS]: () => json({ success: true, proposalId: "30000000-0000-4000-8000-000000000001" }),
    });
    await boot();
    expect(requests.some(({ path }) => path.includes("proof/verify"))).toBe(false);
    await act(async () => {
      form.querySelector<HTMLInputElement>("input[data-consent-input]")!.checked = true;
      form.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(form.textContent).toContain("Ada Lovelace"));
    const verified = requests.find(({ path }) => path.endsWith("proof/verify"));
    expect(eventProposalProofVerifySchema.parse(verified?.body).token).toBe("v".repeat(40));
    expect(form.elements.namedItem("firstName")).toBeNull();
    expect(form.elements.namedItem("email")).toBeNull();
    // Whether the contact also presents is a speaker question, asked on the Speakers step.
    const speakersStep = form.querySelector<HTMLElement>('[data-step="4"]')!;
    expect(speakersStep.querySelector("#proposal-is-presenting")).not.toBeNull();
    await act(() => {
      const presenting = form.querySelector<HTMLInputElement>("#proposal-is-presenting")!;
      presenting.checked = true;
      presenting.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => expect(form.elements.namedItem("proposerBio")).not.toBeNull());
    expect(form.elements.namedItem("proposerSpeakerFirstName")).toBeNull();
    expect(form.elements.namedItem("proposerSpeakerEmail")).toBeNull();
    fill(form, {
      title: "Post-quantum migration",
      abstract:
        "A walk through migrating a working certificate authority to post-quantum algorithms, with the rollbacks we needed.",
      proposerBio: "A speaker biography with enough detail to satisfy the canonical submission contract.",
    });
    await act(() => {
      form.querySelector<HTMLButtonElement>('[aria-label="Markdown source"]')!.click();
    });
    await act(() => {
      const abstract = form.querySelector<HTMLTextAreaElement>('textarea[name="abstract"]')!;
      abstract.value =
        "A walk through migrating a working certificate authority to post-quantum algorithms, with the rollbacks we needed.";
      abstract.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(form);
    const submitted = requests.find(({ path, method }) => path === PROPOSALS && method === "POST");
    expect(submitted, document.querySelector("[data-flow-status]")?.textContent ?? "").toBeDefined();
    const parsed = proposalCreateSchema.parse(submitted?.body);
    expect(parsed.continuationToken).toBe("c".repeat(40));
    expect(parsed.inviteToken).toBe("refreshed-invitation-capability");
    expect(parsed.inviteId).toBe("40000000-0000-4000-8000-000000000001");
    expect(parsed.sourceType).toBe("invite");
    expect(parsed.sourceRef).toBe("invite");
    expect(parsed.referralCode).toBe("ABC12345");
    expect(parsed.unaffiliatedAttestation).toBe(true);
    expect(parsed.proposer.actingIdentityId).toBeNull();
    expect(parsed.proposer.firstName).toBeUndefined();
    expect(parsed.proposer.email).toBeUndefined();
    expect(parsed.proposer.bio).toContain("speaker biography");
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
