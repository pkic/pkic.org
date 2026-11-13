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

import { proposalCreateResponseSchema, proposalCreateSchema } from "../../assets/shared/schemas/proposal-management";
import { eventProposalProofIdentityPatchSchema } from "../../assets/shared/schemas/event-proposal-proof";
import { userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { renderToString } from "preact-render-to-string";
import { EventProposalForm } from "../../assets/ts/site/EventProposalForm";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";
import { buttonNamed, controlFor, toggleChoice, typeInto } from "./helpers/labeled-control";
import {
  chooseProposerIdentity,
  proposerIdentity,
  PROPOSER_IDENTITY_ID,
  signedInProposer,
  signedOutResponse,
} from "./helpers/proposal-identity-fixture";

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

/** `account` answers who is signed in; without one the session read is refused, as for a visitor. */
function installApi(
  routes: Record<string, () => Response>,
  account: (path: string) => Response | undefined = (path) =>
    path === "/api/v1/auth/session" ? signedOutResponse() : undefined,
): Captured[] {
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
      return Promise.resolve(route ? route() : (account(url.pathname) ?? json({})));
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
        document.querySelector<HTMLElement>("[data-flow-status]")?.dataset.state === "error" ||
        document.querySelector<HTMLFormElement>("[data-event-proposal] form")?.hidden,
    ).toBe(true);
  });
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const ABSTRACT =
  "A walk through migrating a working certificate authority to post-quantum algorithms, with the rollbacks we needed.";

function step(form: HTMLFormElement, number: number): HTMLElement {
  return form.querySelector<HTMLElement>(`[data-step="${number}"]`)!;
}

async function next(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.querySelector<HTMLButtonElement>("[data-step-next]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Accepts the terms and continues: the contact step is where the page asks who is signed in. */
async function reachContactStep(form: HTMLFormElement): Promise<void> {
  await toggleChoice(form.querySelector<HTMLInputElement>("input[data-consent-input]")!);
  await next(form);
  expect(step(form, 2).hidden).toBe(false);
}

/** Takes part as an individual, which completes the contact step for a signed-in person. */
async function proposeAsIndividual(form: HTMLFormElement): Promise<void> {
  await vi.waitFor(() => expect(buttonNamed(form, EMAIL_FIRST_COPY.proposal.individualSwitch!)).toBeDefined());
  await act(() => buttonNamed(form, EMAIL_FIRST_COPY.proposal.individualSwitch!).click());
  await completeIndependentCapacityDisclosure(form);
}

async function writeMarkdown(form: HTMLFormElement, name: string, value: string): Promise<void> {
  const editor = form.querySelector(`[name="${name}"]`)!.closest(".pk-markdown-editor")!;
  await act(() => {
    editor.querySelector<HTMLButtonElement>('[aria-label="Markdown source"]')!.click();
  });
  await act(() => {
    const source = editor.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`)!;
    source.value = value;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
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
  it("shows the event's configured session name while submitting its stable identifier", async () => {
    mountShell();
    installApi({
      [PLACEMENTS]: () =>
        json({
          ...placements(),
          sessionTypes: [{ label: "talk", name: "Technical presentation", requiresPresentation: true }],
        }),
    });
    await boot();
    const radio = document.querySelector<HTMLInputElement>('input[name="proposalType"][value="talk"]');
    expect(radio).not.toBeNull();
    expect(document.querySelector("[data-session-types]")?.textContent).toContain("Technical presentation");
    expect(radio?.checked).toBe(true);
    expect(radio?.value).toBe("talk");
  });

  it.each(["scheduled", "closed"])(
    "replaces the public proposal form with a helpful notice when its canonical event window is %s",
    async (state) => {
      const form = mountShell();
      const id = "10000000-0000-4000-8000-000000000001";
      const at = new Date().toISOString();
      const requests = installApi({
        [PLACEMENTS]: () =>
          json({
            ...placements(),
            form: {
              id,
              key: "website-proposals",
              title: "Proposal form",
              description: null,
              fields: [],
              placement: {
                id,
                formId: id,
                ownerGroupId: null,
                contextType: "event",
                contextRef: "20000000-0000-4000-8000-000000000001",
                audience: "speaker",
                active: true,
                createdAt: at,
                updatedAt: at,
                opensAt: state === "scheduled" ? "2099-01-01T00:00:00.000Z" : null,
                closesAt: state === "closed" ? "2000-01-01T00:00:00.000Z" : null,
              },
            },
          }),
      });
      await boot();
      expect([...form.querySelectorAll<HTMLInputElement>("input")].every((control) => control.disabled)).toBe(true);
      expect(form.hidden).toBe(true);
      expect(document.querySelector<HTMLElement>(".event-flow-stepper")?.hidden).toBe(true);
      const notice = document.querySelector(".pk-alert--info[role='status']");
      expect(notice?.textContent).toContain(state === "scheduled" ? "has not opened yet" : "is closed");
      expect(notice?.textContent).toContain("management link in your confirmation email");
      expect(notice?.textContent).not.toContain("Loading");
      await submit(form);
      expect(requests.some(({ method }) => method === "POST")).toBe(false);
    },
  );

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
      abstract: ABSTRACT,
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

  it("asks a visitor to sign in on the contact step, and its sign-in form never submits the proposal", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/propose/?source=newsletter#verify=" + "v".repeat(40));
    const form = mountShell();
    const requests = installApi({
      [PLACEMENTS]: () => json(placements([term()])),
      "/api/v1/auth/request-link": () => json({ success: true }),
    });
    await boot();
    // A confirmation link no longer skips the terms or confirms a mailbox on this page.
    expect(step(form, 1).hidden).toBe(false);
    await reachContactStep(form);
    await vi.waitFor(() => expect(form.querySelector('section[aria-label="Sign in"]')).not.toBeNull());
    const card = form.querySelector<HTMLElement>('section[aria-label="Sign in"]')!;
    expect(step(form, 2).contains(card)).toBe(true);
    expect(form.querySelector<HTMLButtonElement>("[data-step-next]")!.hidden).toBe(true);

    // jsdom has no passkey support, so the card opens on its email-link form.
    await typeInto(controlFor(card, "Email"), "ada@example.test");
    await act(async () => {
      [...card.querySelectorAll("button")]
        .find((button) => /send sign-in link/i.test(button.textContent ?? ""))!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(requests.some(({ path }) => path === "/api/v1/auth/request-link")).toBe(true));
    const link = requests.find(({ path }) => path === "/api/v1/auth/request-link");
    expect(userAuthRequestSchema.parse(link?.body)).toEqual({
      email: "ada@example.test",
      returnPath: "/events/2026/pqc-2026/propose/?source=newsletter",
    });
    // The proposal form's own submit never ran: nothing was validated, announced or sent.
    expect(document.querySelector<HTMLElement>("[data-flow-status]")?.dataset["state"]).not.toBe("error");
    expect(step(form, 2).hidden).toBe(false);
    expect(requests.some(({ path }) => path.startsWith(PROPOSALS))).toBe(false);
  });

  it("submits a signed-in individual's proposal with the page's entry context and no duplicate personal fields", async () => {
    const inviteId = "40000000-0000-4000-8000-000000000001";
    window.history.replaceState(
      {},
      "",
      `/events/2026/pqc-2026/propose/?invite=original-invitation-capability&id=${inviteId}&source=invite&ref=ABC12345`,
    );
    const form = mountShell();
    const created = proposalCreateResponseSchema.parse({
      success: true,
      proposalId: "30000000-0000-4000-8000-000000000001",
      status: "submitted",
      manageToken: "m".repeat(40),
      manageUrl: "https://pkic.org/events/2026/pqc-2026/proposal/#manage",
      shareUrl: "https://pkic.org/events/2026/pqc-2026/",
    });
    const requests = installApi(
      { [PLACEMENTS]: () => json(placements([term()])), [PROPOSALS]: () => json(created) },
      signedInProposer(),
    );
    await boot();
    await reachContactStep(form);
    await vi.waitFor(() => expect(form.querySelector('[role="combobox"]')).not.toBeNull());
    // Nothing continues until the person has said who they take part as.
    expect(form.querySelector<HTMLButtonElement>("[data-step-next]")!.hidden).toBe(true);
    await proposeAsIndividual(form);
    expect(form.querySelector<HTMLButtonElement>("[data-step-next]")!.hidden).toBe(false);
    expect(form.textContent).toContain("Ada Lovelace");
    expect(form.elements.namedItem("firstName")).toBeNull();
    expect(form.elements.namedItem("email")).toBeNull();
    // Whether the contact also presents is a speaker question, asked on the Speakers step.
    expect(step(form, 4).querySelector("#proposal-is-presenting")).not.toBeNull();
    await act(() => {
      const presenting = form.querySelector<HTMLInputElement>("#proposal-is-presenting")!;
      presenting.checked = true;
      presenting.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => expect(form.elements.namedItem("proposerBio")).not.toBeNull());
    expect(form.elements.namedItem("proposerSpeakerFirstName")).toBeNull();
    expect(form.elements.namedItem("proposerSpeakerEmail")).toBeNull();
    fill(form, { title: "Post-quantum migration", committeeNotes: "Happy to adapt this into a panel." });
    await writeMarkdown(form, "abstract", ABSTRACT);
    await writeMarkdown(
      form,
      "proposerBio",
      "A speaker biography with enough detail to satisfy the canonical submission contract.",
    );
    await submit(form);
    const submitted = requests.find(({ path, method }) => path === PROPOSALS && method === "POST");
    expect(submitted, document.querySelector("[data-flow-status]")?.textContent ?? "").toBeDefined();
    const parsed = proposalCreateSchema.parse(submitted?.body);
    expect(submitted?.body).not.toHaveProperty("continuationToken");
    expect(parsed.consents).toEqual([{ termKey: "speaker-agreement", version: "1" }]);
    expect(parsed).toMatchObject({
      inviteToken: "original-invitation-capability",
      inviteId,
      sourceType: "invite",
      referralCode: "ABC12345",
      unaffiliatedAttestation: true,
      independentCapacity: { organizationConnection: "no" },
    });
    expect(parsed.proposer.actingIdentityId).toBeNull();
    expect(parsed.proposer.firstName).toBeUndefined();
    expect(parsed.proposer.email).toBeUndefined();
    expect(parsed.proposer.organizationName).toBeUndefined();
    expect(parsed.proposer.jobTitle).toBeUndefined();
    expect(parsed.proposer.bio).toContain("speaker biography");
    // Private notes travel apart from the abstract, which is what gets published.
    expect(parsed.proposal.committeeNotes).toBe("Happy to adapt this into a panel.");
    expect(parsed.proposal.abstract).not.toContain("panel");
    expect(requests.some(({ path }) => path.startsWith(`${PROPOSALS}/proof`))).toBe(false);
    await vi.waitFor(() => expect(form.hidden).toBe(true));
    expect(document.querySelector<HTMLAnchorElement>(`a[href="${created.manageUrl}"]`)).not.toBeNull();
  });

  it("submits on behalf of the chosen identity once its job title is saved, with the name the account lacked", async () => {
    const form = mountShell();
    const requests = installApi(
      {
        [PLACEMENTS]: () => json(placements([term()])),
        [`${PROPOSALS}/proof/identities/${PROPOSER_IDENTITY_ID}`]: () =>
          json({
            identityId: PROPOSER_IDENTITY_ID,
            organizationId: null,
            jobTitle: "Security Architect",
            biography: null,
            links: [],
          }),
        [PROPOSALS]: () => json({ error: { code: "UNAVAILABLE", message: "Try again shortly." } }, 503),
      },
      signedInProposer({ firstName: null, lastName: null, identities: [proposerIdentity({ jobTitle: null })] }),
    );
    await boot();
    await reachContactStep(form);
    await chooseProposerIdentity(form, PROPOSER_IDENTITY_ID);
    // A representation without a job title holds the person on the contact step.
    const nextButton = form.querySelector<HTMLButtonElement>("[data-step-next]")!;
    expect(form.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.required).toBe(true);
    expect(nextButton.hidden).toBe(true);
    await typeInto(form.querySelector<HTMLInputElement>('input[name="jobTitle"]')!, "Security Architect");
    await act(async () => {
      buttonNamed(form, "Save representation").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(nextButton.hidden).toBe(false));
    const role = requests.find(({ method }) => method === "PATCH");
    expect(eventProposalProofIdentityPatchSchema.parse(role?.body)).toEqual({ jobTitle: "Security Architect" });
    // The names the account lacks are required before the person continues.
    await next(form);
    expect(step(form, 2).hidden).toBe(false);
    await typeInto(form.querySelector<HTMLInputElement>('input[name="firstName"]')!, "Ada");
    await typeInto(form.querySelector<HTMLInputElement>('input[name="lastName"]')!, "Lovelace");
    await next(form);
    expect(step(form, 3).hidden).toBe(false);
    fill(form, { title: "Post-quantum migration" });
    await writeMarkdown(form, "abstract", ABSTRACT);
    await submit(form);
    const submitted = requests.find(({ path, method }) => path === PROPOSALS && method === "POST");
    expect(submitted, document.querySelector("[data-flow-status]")?.textContent ?? "").toBeDefined();
    const parsed = proposalCreateSchema.parse(submitted?.body);
    expect(parsed.unaffiliatedAttestation).toBe(false);
    expect(parsed.independentCapacity).toBeUndefined();
    expect(parsed.sourceType).toBe("direct");
    expect(parsed.proposer).toMatchObject({
      actingIdentityId: PROPOSER_IDENTITY_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      role: "proposer",
    });
    expect(parsed.proposer.jobTitle).toBeUndefined();
    expect(parsed.proposer.organizationName).toBeUndefined();
    // A refused submission leaves the form in place for another attempt.
    expect(form.hidden).toBe(false);
  });

  it("shows a short abstract's contract error on the Markdown field, as on any other field", async () => {
    const form = mountShell();
    installApi({ [PLACEMENTS]: () => json(placements([term()])) }, signedInProposer());
    await boot();
    await reachContactStep(form);
    await proposeAsIndividual(form);
    await next(form);
    const proposalStep = step(form, 3);
    expect(proposalStep.hidden).toBe(false);
    fill(form, { title: "Post-quantum migration" });
    await writeMarkdown(form, "abstract", "Too short to review.");
    await next(form);
    expect(proposalStep.hidden).toBe(false);
    const abstract = form.querySelector<HTMLTextAreaElement>('textarea[name="abstract"]')!;
    const field = abstract.closest(".pk-field")!;
    expect(field.classList.contains("pk-field--invalid")).toBe(true);
    expect(field.classList.contains("pk-field--ok")).toBe(false);
    expect(abstract.getAttribute("aria-invalid")).toBe("true");
    const message = field.querySelector<HTMLElement>('.pk-field__message[role="alert"]');
    expect(message?.hidden).toBe(false);
    expect(message?.textContent).toContain("80");
    expect(abstract.getAttribute("aria-describedby")).toContain(message!.id);
  });

  it("announces a failed placement load in the flow's live region", async () => {
    mountShell();
    installApi({ [PLACEMENTS]: () => json({ error: "unavailable" }, 503) });

    await boot();

    const status = document.querySelector<HTMLElement>("[data-flow-status]");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.hidden).toBe(false);
    // The tone is in the data attribute as well as the styling, so failure is
    // not told apart from success by color alone.
    expect(status?.dataset["state"]).toBe("error");
    expect(status?.textContent).toContain("Could not load proposal form details.");
  });
});
