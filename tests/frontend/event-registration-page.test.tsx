// @vitest-environment jsdom
/**
 * The registration page starts from the shared email-first step and verifies
 * the address first: the wizard's own Continue stays out of the way until the
 * emailed link has been opened, and the registration carries that proof and
 * the capacity the person chose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { EventRegistrationForm } from "../../assets/ts/site/EventRegistrationForm";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import {
  registrationEmailProofStartSchema,
  registrationEmailProofVerifyResponseSchema,
} from "../../assets/shared/schemas/registration-email-proof";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { chooseCard, controlFor } from "./helpers/labeled-control";

const PLACEMENTS = "/api/v1/events/pqc-2026/forms/placements/event_registration";
const REGISTRATIONS = "/api/v1/events/pqc-2026/registrations";
const copy = EMAIL_FIRST_COPY.registration;

interface Captured {
  path: string;
  body: unknown;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function installApi(workEmail = false): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), location.origin);
      requests.push({ path: url.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      if (url.pathname === PLACEMENTS)
        return Promise.resolve(
          json({
            event: { id: "20000000-0000-4000-8000-000000000001", slug: "pqc-2026", name: "PQC Conference 2026" },
            purpose: "event_registration",
            form: null,
            registrationPolicy: "public",
            requiredTerms: [
              {
                termKey: "privacy-policy",
                version: "v1",
                required: true,
                contentRef: null,
                displayText: "I accept the privacy policy",
                helpText: null,
              },
            ],
            allowedSessionTypes: [],
            eventDays: [],
          }),
        );
      if (url.pathname === "/api/v1/auth/session")
        return Promise.resolve(json({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, 401));
      if (url.pathname === `${REGISTRATIONS}/proof`) return Promise.resolve(json({ status: "verification_sent" }));
      if (url.pathname === `${REGISTRATIONS}/proof/verify`)
        return Promise.resolve(
          json(
            registrationEmailProofVerifyResponseSchema.parse({
              email: workEmail ? "attendee@example.test" : "ada@gmail.com",
              unaffiliatedAttestation: !workEmail,
              person: null,
              asksOrganization: workEmail,
              affiliation: workEmail
                ? {
                    email: "attendee@example.test",
                    domain: "example.test",
                    domains: [{ domain: "example.test", canLink: false, organizationName: "Example organization" }],
                    organization: { id: "00000000-0000-4000-8000-000000000044", name: "Example organization" },
                    organizations: [
                      {
                        id: "00000000-0000-4000-8000-000000000044",
                        name: "Example organization",
                        identityId: null,
                        jobTitle: null,
                      },
                    ],
                  }
                : null,
            }),
          ),
        );
      if (url.pathname === REGISTRATIONS)
        return Promise.resolve(
          json({
            success: true,
            registrationId: "30000000-0000-4000-8000-000000000001",
            status: "registered",
            manageToken: null,
            manageUrl: null,
            shareUrl: null,
            dayAttendance: [],
            dayWaitlist: [],
          }),
        );
      return Promise.resolve(json({}));
    }),
  );
  return requests;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`no button reads "${label}"`);
  return match;
}

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/2026/pqc-2026/register/");
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

async function loadPage(workEmail = false): Promise<Captured[]> {
  document.body.innerHTML = renderToString(<EventRegistrationForm />);
  document.querySelector<HTMLElement>("[data-event-registration]")!.dataset.eventSlug = "pqc-2026";
  const requests = installApi(workEmail);
  await act(async () => {
    await import("../../assets/ts/event-flows/registration-page");
  });
  await settle();
  return requests;
}

describe("registration email-first entry", () => {
  it("opens on the email alone and sends a verification link before asking anything else", async () => {
    const requests = await loadPage();
    const next = document.querySelector<HTMLButtonElement>("[data-step-next]")!;
    const step = document.querySelector<HTMLElement>('[data-step="1"]')!;
    expect(step.querySelectorAll('input:not([type="radio"])')).toHaveLength(1);
    expect(next.hidden).toBe(true);

    await chooseCard(step, copy.personal.title);
    await act(() => {
      const email = controlFor(step, copy.personal.label);
      email.value = "ada@gmail.com";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(copy.personal.action).click());
    await settle();
    const proof = requests.find((request) => request.path === `${REGISTRATIONS}/proof`);
    expect(registrationEmailProofStartSchema.parse(proof!.body)).toMatchObject({
      email: "ada@gmail.com",
      unaffiliatedAttestation: true,
    });
    expect(step.textContent).toContain(copy.sent("ada@gmail.com"));
    expect(next.hidden).toBe(true);
  });

  it("does not validate on arrival and focuses missing contact fields before the job title", async () => {
    history.replaceState({}, "", "/events/2026/pqc-2026/register/#verify=synthetic-proof-0123456789abcdefghijklmnop");
    await loadPage(true);
    const first = controlFor(document.body, "First name");
    const last = controlFor(document.body, "Last name");
    const title = controlFor(document.body, "Job title");
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(document.activeElement).not.toBe(title);
    const next = document.querySelector<HTMLButtonElement>("[data-step-next]")!;
    await act(() => next.click());
    await settle();
    expect(document.activeElement).toBe(first);
    expect(title.getAttribute("aria-invalid")).not.toBe("true");
    for (const [control, value] of [
      [first, "Test"],
      [last, "Attendee"],
    ] as const) {
      await act(() => {
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(() => next.click());
    await settle();
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute("aria-invalid")).toBe("true");
  });

  it("continues from the opened link and registers with the proof and the chosen capacity", async () => {
    window.history.replaceState(
      {},
      "",
      "/events/2026/pqc-2026/register/#verify=proof-token-0123456789abcdefghijklmnop",
    );
    const requests = await loadPage();
    const form = document.querySelector("form")!;
    const step = document.querySelector<HTMLElement>('[data-step="1"]')!;
    expect(document.querySelector<HTMLButtonElement>("[data-step-next]")!.hidden).toBe(false);
    for (const [label, value] of [
      ["First name", "Ada"],
      ["Last name", "Lovelace"],
    ]) {
      const control = controlFor(step, label);
      await act(() => {
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
    }

    expect(controlFor(step, "First name").value).toBe("Ada");
    expect(controlFor(step, "Last name").value).toBe("Lovelace");
    await act(async () => {
      form.querySelector<HTMLInputElement>("[data-term-key] input")!.checked = true;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    const submitted = requests.find((request) => request.path === REGISTRATIONS);
    expect(submitted, document.querySelector("[data-flow-status]")?.textContent ?? "").toBeDefined();
    expect(registrationCreateSchema.parse(submitted!.body)).toMatchObject({
      email: "ada@gmail.com",
      firstName: "Ada",
      lastName: "Lovelace",
      unaffiliatedAttestation: true,
      emailProof: "proof-token-0123456789abcdefghijklmnop",
    });
    expect(document.body.textContent).toContain("You're registered, Ada!");
    // The proof is spent: registering someone else in this tab starts from the email again.
    expect(Object.keys(sessionStorage).filter((key) => key.startsWith("pkic.registration.emailProof"))).toEqual([]);
  });
});
