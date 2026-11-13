// @vitest-environment jsdom
/**
 * The registration page continues with the session: a signed-out visitor gets
 * the shared sign-in card in place of the form, and a signed-in person
 * registers with their saved details.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { EventRegistrationForm } from "../../assets/ts/site/EventRegistrationForm";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import { myProfileUpdateSchema } from "../../assets/shared/schemas/me";
import { emailDomainResponseSchema } from "../../assets/shared/schemas/email-domains";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";
import { FORMS } from "./helpers/participant-registration-fixtures";
import { controlFor } from "./helpers/labeled-control";

const PLACEMENTS = "/api/v1/events/pqc-2026/forms/placements/event_registration";
const REGISTRATIONS = "/api/v1/events/pqc-2026/registrations";
const SESSION = portalSessionFixture({ member: true });

interface Captured {
  path: string;
  body: unknown;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

interface SavedNames {
  firstName: string | null;
  lastName: string | null;
}

/** `person` null leaves the browser signed out; otherwise the session's saved names. */
function installApi(scheduled = true, person: SavedNames | null = null): Captured[] {
  const requests: Captured[] = [];
  let profile = person && { ...portalProfileFixture(SESSION), ...person };
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
            form: {
              ...FORMS.form,
              title: "Administrative registration questions",
              description: "Internal placement description",
            },
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
            eventDays: scheduled
              ? [
                  {
                    dayDate: "2026-12-01",
                    label: "Day one",
                    sortOrder: 0,
                    inPersonCapacity: null,
                    attendanceOptions: [{ value: "virtual", label: "Online" }],
                  },
                ]
              : [],
          }),
        );
      if (url.pathname === "/api/v1/auth/session")
        return Promise.resolve(
          profile ? json(SESSION) : json({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, 401),
        );
      if (url.pathname === "/api/v1/users/current" && profile) {
        if (init.method === "PATCH")
          profile = { ...profile, ...myProfileUpdateSchema.parse(JSON.parse(String(init.body))) };
        return Promise.resolve(json(profile));
      }
      if (url.pathname.startsWith("/api/v1/email/domains/"))
        return Promise.resolve(
          json(emailDomainResponseSchema.parse({ domain: url.pathname.split("/").at(-1), kind: "free" })),
        );
      if (url.pathname === REGISTRATIONS)
        return Promise.resolve(
          json({
            success: true,
            registrationId: "30000000-0000-4000-8000-000000000001",
            status: "registered",
            startsAt: "2026-12-01T08:00:00.000Z",
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
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

async function loadPage(scheduled = true, person: SavedNames | null = null): Promise<Captured[]> {
  document.body.innerHTML = renderToString(<EventRegistrationForm />);
  document.querySelector<HTMLElement>("[data-event-registration]")!.dataset.eventSlug = "pqc-2026";
  const requests = installApi(scheduled, person);
  await act(async () => {
    await import("../../assets/ts/event-flows/registration-page");
  });
  await settle();
  return requests;
}

describe("registration entry", () => {
  it("shows embedded questions without the administrative form title or description", async () => {
    await loadPage();
    expect(document.body.textContent).toContain("Dietary requirements");
    expect(document.body.textContent).not.toContain("Administrative registration questions");
    expect(document.body.textContent).not.toContain("Internal placement description");
  });
  it("explains that registration is unavailable until event days are scheduled", async () => {
    const requests = await loadPage(false);
    expect(document.body.textContent).toContain("Registration opens when the event days are scheduled.");
    expect(document.querySelector('[aria-label="Registration progress"]')).toBeNull();
    expect(document.querySelector('section[aria-label="Sign in"]')).toBeNull();
    expect(requests.some((request) => request.path === REGISTRATIONS)).toBe(false);
  });

  it("shows a signed-out visitor the sign-in card in place of the registration form", async () => {
    const requests = await loadPage();
    const form = document.querySelector<HTMLFormElement>("form[novalidate].needs-validation")!;
    const card = document.querySelector<HTMLElement>('section[aria-label="Sign in"]')!;
    expect(card).not.toBeNull();
    expect(form.contains(card)).toBe(false);
    expect(form.hidden).toBe(true);
    expect(document.querySelector('[aria-label="Registration progress"]')).not.toBeNull();
    expect(requests.some((request) => request.path === REGISTRATIONS)).toBe(false);
  });

  it.each([null, "", "saved@example.test"])(
    "requires saving a corrected existing name (%s) before continuing",
    async (firstName) => {
      const requests = await loadPage(true, { firstName, lastName: "Fixture" });
      expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
      const next = document.querySelector<HTMLButtonElement>("[data-step-next]")!;
      await act(() => next.click());
      await settle();
      const editor = document.querySelector("dialog")!;
      const first = controlFor(editor, "First name");
      expect(first.getAttribute("aria-invalid")).toBe("true");
      await act(() => {
        first.value = "Zoë";
        first.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => button("Save my details").click());
      await settle();
      const correction = requests.findLast((request) => request.path === "/api/v1/users/current" && request.body)!;
      expect(myProfileUpdateSchema.parse(correction.body)).toMatchObject({ firstName: "Zoë", lastName: "Fixture" });
      expect(document.querySelector<HTMLInputElement>('input[type="hidden"][name="firstName"]')!.value).toBe("Zoë");
      await act(() => next.click());
      await settle();
      expect(document.querySelector<HTMLElement>('[data-step="2"]')!.hidden).toBe(false);
    },
  );

  it("registers a signed-in person with their session and saved details", async () => {
    const requests = await loadPage(true, { firstName: "Ada", lastName: "Lovelace" });
    const form = document.querySelector<HTMLFormElement>("form[novalidate].needs-validation")!;
    expect(form.hidden).toBe(false);
    expect(document.querySelector('section[aria-label="Sign in"]')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-step-next]")!.hidden).toBe(false);
    await act(async () => {
      form.querySelector<HTMLInputElement>('input[name="dayAttendance.2026-12-01"]')!.click();
      form.querySelector<HTMLInputElement>("[data-term-key] input")!.checked = true;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    const submitted = requests.find((request) => request.path === REGISTRATIONS);
    expect(submitted, document.querySelector("[data-flow-status]")?.textContent ?? "").toBeDefined();
    expect(registrationCreateSchema.parse(submitted!.body)).toMatchObject({
      email: SESSION.identity.email,
      firstName: "Ada",
      lastName: "Lovelace",
      identityId: SESSION.actingIdentityId,
      unaffiliatedAttestation: true,
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
    });
    expect(submitted!.body).not.toHaveProperty("attendanceType");
    expect(
      registrationCreateSchema.safeParse({ ...registrationCreateSchema.parse(submitted!.body), dayAttendance: [] })
        .success,
    ).toBe(false);
    expect(document.body.textContent).toContain("You're registered, Ada!");
  });
});
