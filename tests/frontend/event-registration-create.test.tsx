// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventFormsResponseSchema } from "../../assets/shared/schemas/forms";
import { registrationCreateForTermsSchema, registrationCreateSchema } from "../../assets/shared/schemas/registration";
import { EventRegistrationCreate } from "../../assets/ts/components/events/EventRegistrationCreate";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";

let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});

it("uses the session address, validates event questions, and submits the shared contract without email proof", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const session = portalSessionFixture({});
  const profile = {
    ...portalProfileFixture(session),
    firstName: "Ada",
    lastName: "Lovelace",
    email: "other@example.test",
  };
  const config = eventFormsResponseSchema.parse({
    event: { id: "event-1", slug: "summit", name: "Summit" },
    purpose: "event_registration",
    registrationPolicy: "public",
    eventDays: [
      {
        dayDate: "2027-09-10",
        label: "Workshop",
        sortOrder: 0,
        inPersonCapacity: null,
        attendanceOptions: [
          { value: "virtual", label: "Watch online" },
          { value: "in_person", label: "At the venue" },
        ],
      },
    ],
    requiredTerms: [
      {
        termKey: "privacy",
        version: "1",
        required: true,
        contentRef: null,
        displayText: "I agree to the privacy policy",
      },
    ],
    allowedSessionTypes: [],
    form: {
      id: "00000000-0000-4000-8000-000000000011",
      key: "registration",
      title: "Event questions",
      description: null,
      fields: [
        {
          id: "00000000-0000-4000-8000-000000000012",
          key: "interest",
          label: "Your interest",
          fieldType: "text",
          required: true,
          options: null,
          optionSource: null,
          validation: null,
          sortOrder: 0,
          updatedAt: "2026-01-01T00:00:00.000Z",
          archivedAt: null,
        },
        {
          id: "00000000-0000-4000-8000-000000000014",
          key: "dietary_restrictions",
          label: "Dietary restrictions",
          fieldType: "multi_select",
          required: false,
          options: ["Nut allergy", "Vegan"],
          optionSource: null,
          validation: {
            uiWidget: "checkboxes",
            showWhen: { dayAttendanceIn: ["in_person"] },
            helpText: "The venue receives these answers. Accommodation cannot be guaranteed.",
          },
          sortOrder: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          archivedAt: null,
        },
      ],
    },
  });
  const terms = [...config.requiredTerms, { ...config.requiredTerms[0], termKey: "conduct" }];
  const consentContract = registrationCreateForTermsSchema(terms);
  const request = {
    email: "ada@example.test",
    firstName: "Ada",
    lastName: "Lovelace",
    attendanceType: "virtual",
    consents: [{ termKey: "privacy", version: "1" }],
  };
  expect(consentContract.safeParse(request).success).toBe(false);
  expect(
    consentContract.safeParse({ ...request, consents: [...request.consents, { termKey: "conduct", version: "old" }] })
      .success,
  ).toBe(false);
  expect(
    consentContract.safeParse({ ...request, consents: [...request.consents, { termKey: "conduct", version: "1" }] })
      .success,
  ).toBe(true);
  const posted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      let body: unknown;
      if (init?.method === "POST") {
        expect(path).toBe("/api/v1/events/summit/registrations");
        posted.push(registrationCreateSchema.parse(JSON.parse(String(init.body))));
        body = {
          success: true,
          registrationId: "00000000-0000-4000-8000-000000000013",
          status: "registered",
          shareUrl: null,
          manageUrl: null,
          manageToken: null,
          dayAttendance: [],
          dayWaitlist: [],
        };
      } else if (path === "/api/v1/auth/session") body = session;
      else if (path === "/api/v1/users/current") body = profile;
      else if (path.endsWith("/forms/placements/event_registration")) body = config;
      else if (path === "/api/v1/users/current/identities")
        body = { identities: [], page: { limit: 1, offset: 0, total: 0, hasMore: false } };
      else throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }),
  );
  const onRegistered = vi.fn(async () => {});
  await act(() => render(<EventRegistrationCreate slug="summit" onRegistered={onRegistered} />, host));
  await vi.waitFor(() => expect(host.querySelector("form")).not.toBeNull());
  expect(host.textContent).toContain("Ada Lovelace");
  expect(host.textContent).toContain(session.identity.email);
  expect(host.textContent).not.toContain(profile.email);
  expect(host.querySelector('input[name="email"]')?.getAttribute("type")).toBe("hidden");
  await act(() => host.querySelector<HTMLInputElement>('input[value="virtual"]')!.click());
  expect(host.querySelector('[data-custom-field-key="dietary_restrictions"]')?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  await act(() => host.querySelector<HTMLInputElement>('input[value="in_person"]')!.click());
  expect(host.querySelector('[data-custom-field-key="dietary_restrictions"]')?.getAttribute("aria-hidden")).toBe(
    "false",
  );
  expect(host.textContent).toContain(config.form!.fields[1].validation!.helpText);
  expect(host.textContent).toContain("Nut allergy");
  await act(() => host.querySelector<HTMLInputElement>('input[value="virtual"]')!.click());
  expect(host.querySelector('[data-custom-field-key="dietary_restrictions"]')?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const privacy = host.querySelector<HTMLElement>('[data-term-key="privacy"]')!;
  expect(privacy.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
  expect(privacy.querySelector('[role="alert"]')?.textContent).toContain("Agree to this required term to continue.");
  expect(host.textContent).not.toContain("Too small:");
  expect(host.querySelector(".pk-field--group > .pk-field__control > .pk-field__state")).toBeNull();
  await act(() => host.querySelector<HTMLInputElement>('input[name="consents"]')!.click());
  expect(privacy.querySelector("input")?.getAttribute("aria-invalid")).toBeNull();
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(posted).toEqual([]);
  expect(host.querySelector('input[name="custom.interest"]')?.getAttribute("aria-invalid")).toBe("true");
  const answer = host.querySelector<HTMLInputElement>('input[name="custom.interest"]')!;
  await act(() => {
    answer.value = "Migration";
    answer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(onRegistered).toHaveBeenCalledOnce());
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    email: session.identity.email,
    firstName: "Ada",
    lastName: "Lovelace",
    customAnswers: { interest: "Migration" },
    dayAttendance: [{ dayDate: "2027-09-10", attendanceType: "virtual" }],
  });
  expect(posted[0]).not.toHaveProperty("emailProof");
});
