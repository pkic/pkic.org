// @vitest-environment jsdom
/** The attendee's registration summary, editing, day changes, and cancellation. */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventFormsResponseSchema } from "../../assets/shared/schemas/forms";
import {
  registrationManageSchema,
  type RegistrationManageReadResponse,
} from "../../assets/shared/schemas/registration";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { ParticipantRegistration } from "../../assets/ts/components/events/ParticipantRegistration";
import { RegistrationIdentityChange } from "../../assets/ts/components/events/RegistrationIdentityChange";
import { registrationIdentityChangeSchema } from "../../assets/shared/schemas/registration-identity";
import { REGISTRATION_ID, ENDPOINT, EVENT, readResponse, FORMS } from "./helpers/participant-registration-fixtures";
import { confirmationButton, openConfirmation } from "./helpers/confirm-dialog";

const mounted: HTMLElement[] = [];

function installApi(
  read: RegistrationManageReadResponse = readResponse(),
  options: { forms?: typeof FORMS; refusePatch?: unknown } = {},
) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ method, path: url.pathname, body });
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      if (method === "GET" && url.pathname === ENDPOINT) return json(read);
      if (method === "GET" && url.pathname.endsWith("/forms/placements/event_registration")) {
        return json({ ...(options.forms ?? FORMS), eventDays: read.eventDays });
      }
      if (method === "PATCH" && url.pathname === ENDPOINT && options.refusePatch) {
        return new Response(JSON.stringify(options.refusePatch), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "PATCH" && url.pathname === ENDPOINT) {
        return json({ success: true, emailChanged: false, sponsorSharing: read.sponsorSharing });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <ParticipantRegistration registrationId={REGISTRATION_ID} eventId={EVENT.id} slug={EVENT.slug} />
      </>,
      container,
    ),
  );
  await settle();
  await settle();
  return container;
}

function button(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === label && !b.closest("[hidden]"),
    ) ?? null
  );
}

function facts(root: ParentNode): Record<string, string> {
  const terms = [...root.querySelectorAll("dl.pk-datalist:not(.pk-alert dl) > dt")];
  return Object.fromEntries(terms.map((term) => [term.textContent ?? "", term.nextElementSibling?.textContent ?? ""]));
}

async function click(target: HTMLElement | null): Promise<void> {
  if (!target) throw new Error("control not found");
  await act(async () => target.click());
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("ParticipantRegistration", () => {
  it("retries a failed refresh without saving the representation twice", async () => {
    const identity = {
      id: "00000000-0000-4000-8000-000000000042",
      organizationId: null,
      organizationName: null,
      jobTitle: null,
    };
    const fetch = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "PUT"
              ? { success: true, identity, badgeVersion: "2026-01-01T00:00:00.000Z" }
              : {
                  success: true,
                  sessionId: "00000000-0000-4000-8000-000000000045",
                  expiresAt: "2099-12-31T23:59:59.000Z",
                  idleExpiresAt: "2099-12-31T23:59:59.000Z",
                  identity: { id: "00000000-0000-4000-8000-000000000041", email: "ada@example.test" },
                  eventParticipation: true,
                  actingIdentityId: identity.id,
                  actingIdentities: [identity],
                },
          ),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const changed = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() =>
      render(
        <RegistrationIdentityChange data={readResponse({ identityId: identity.id })} onChanged={changed} />,
        container,
      ),
    );
    await click(container.querySelector('button[aria-label="Change representation"]'));
    await click(button(document, "Save changes"));
    await vi.waitFor(() => expect(container.textContent).toContain("could not be refreshed"));
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(registrationIdentityChangeSchema.parse(JSON.parse(String(writes[0]![1]?.body)))).toMatchObject({
      identityId: identity.id,
    });
    await click(button(container, "Retry refresh"));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(button(container, "Retry refresh")).toBeNull();
  });
  it("opens read-only, with the registration's details as a description list", async () => {
    installApi();
    const container = await mount();

    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    // The page header and tab already name the page; the panel adds no third "Registration".
    expect(container.querySelector(".pk-panel__header")).toBeNull();
    expect(facts(container)).toMatchObject({
      Name: "Ada Lovelace",
      "Email address": expect.stringContaining("ada@example.test"),
      Representation: "Analytical Engines · Engineer",
      "Dietary requirements": "Vegetarian",
    });
    // A confirmed address carries a tick after it instead of a separate "Email confirmed" line.
    expect(container.querySelector(".pk-verified-value__mark")?.textContent).toBe("confirmed");
    expect(container.textContent).not.toContain("Email confirmed");
    // A normal registration needs no "Registered" badge: the days below already say it.
    expect(container.textContent).not.toContain("Registered");
    // The confirmed-days summary already states each day; the fact list does not repeat it.
    expect(facts(container)).not.toHaveProperty("Day 1");
    expect(button(container, "Edit details")?.classList.contains("pk-btn--primary")).toBe(true);
    expect(button(container, "Save changes")).toBeNull();
    // Each day is a card with its state in words and the change it allows.
    // The shared day summary states the days in words, grouped by what they amount to.
    const summary = container.querySelector('[aria-label="Your registration, day by day"]');
    expect(summary?.textContent).toContain("In-person");
    expect(button(container, "Change my days")).not.toBeNull();
    expect(button(container, "Can't make it in person?")).toBeNull();
    // Cancelling is findable on the page, set apart and quiet, never the main action.
    expect(button(container, "Cancel my registration…")?.classList.contains("pk-btn--danger-quiet")).toBe(true);
  });

  it("swaps the read view for the form on Edit, and Discard resets the draft and returns", async () => {
    const requests = installApi();
    const container = await mount();

    await click(button(container, "Edit details"));
    const lastName = container.querySelector<HTMLInputElement>('input[name="lastName"]');
    expect(lastName?.value).toBe("Lovelace");
    expect(button(container, "Save changes")?.type).toBe("submit");
    expect(button(container, "Save changes")?.classList.contains("pk-btn--primary")).toBe(true);
    expect(button(container, "Discard changes")).not.toBeNull();
    expect(button(container, "Cancel my registration…")).toBeNull();

    await act(async () => {
      lastName!.value = "Byron";
      lastName!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button(container, "Discard changes"));

    await vi.waitFor(() => expect(button(container, "Edit details")).not.toBeNull());
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(facts(container)["Name"]).toBe("Ada Lovelace");
    await click(button(container, "Edit details"));
    expect(container.querySelector<HTMLInputElement>('input[name="lastName"]')?.value).toBe("Lovelace");
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
  });

  it("shows organization and job title read-only from the identity, with where to manage them", async () => {
    installApi();
    const container = await mount();

    await click(button(container, "Edit details"));
    expect(container.querySelector('input[name="organizationName"], input[name="jobTitle"]')).toBeNull();
    expect(facts(container)).toMatchObject({ Representation: "Analytical Engines · Engineer" });
    const manage = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "Manage identities");
    expect(manage?.getAttribute("href")).toBe("/portal/#/users/current");
  });

  it("names an organization awaiting staff review instead of showing Personal", async () => {
    installApi(
      readResponse({
        user: { ...readResponse().user, organization_name: null, job_title: "Engineer" },
        pendingOrganizationName: "Analytical Engines",
      }),
    );
    const container = await mount();

    expect(facts(container)).toMatchObject({ Representation: "Analytical Engines · Engineer · awaiting review" });
  });

  it("preserves the registration update draft through browser Back and Forward", async () => {
    const requests = installApi();
    const container = await mount();
    await click(button(container, "Edit details"));
    const lastName = container.querySelector<HTMLInputElement>('input[name="lastName"]')!;
    await act(() => {
      lastName.value = "Draft name";
      lastName.dispatchEvent(new Event("input", { bubbles: true }));
      history.back();
    });
    await vi.waitFor(() => expect(button(container, "Edit details")).not.toBeNull());
    await act(() => history.forward());
    await vi.waitFor(() => expect(button(container, "Save changes")).not.toBeNull());
    expect(container.querySelector<HTMLInputElement>('input[name="lastName"]')!.value).toBe("Draft name");
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
    await click(button(container, "Discard changes"));
    await vi.waitFor(() => expect(button(container, "Edit details")).not.toBeNull());
  });

  it("saves through the shared contract and returns to the read view with the outcome", async () => {
    const requests = installApi();
    const container = await mount();

    await click(button(container, "Edit details"));
    const lastName = container.querySelector<HTMLInputElement>('input[name="lastName"]');
    await act(async () => {
      lastName!.value = "Byron";
      lastName!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await settle();

    const patch = requests.find(({ method }) => method === "PATCH");
    expect(registrationManageSchema.parse(patch?.body)).toMatchObject({
      action: "update",
      lastName: "Byron",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Registration updated."));
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
  });

  it("cancels only after the confirmation, and Keep registration sends nothing", async () => {
    const requests = installApi();
    const container = await mount();

    await click(button(container, "Cancel my registration…"));
    expect(openConfirmation()?.textContent).toContain("Cancel your registration?");
    expect(openConfirmation()?.textContent).toContain("restore");
    await click(confirmationButton("Keep registration"));
    expect(openConfirmation()).toBeNull();
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);

    await click(button(container, "Cancel my registration…"));
    await click(confirmationButton("Cancel registration"));
    await settle();

    const patches = requests.filter(({ method }) => method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(registrationManageSchema.parse(patches[0]?.body)).toEqual({ action: "cancel" });
  });

  it("offers restore, as the main action, for a cancelled registration and nothing to edit or cancel", async () => {
    const requests = installApi(
      readResponse({
        registration: { ...readResponse().registration, status: "cancelled", cancellation_reason_code: "self" },
      }),
    );
    const container = await mount();

    expect(button(container, "Edit details")).toBeNull();
    expect(button(container, "Cancel my registration…")).toBeNull();
    expect(button(container, "Can't make it in person?")).toBeNull();
    const restore = button(container, "Restore registration");
    expect(restore?.classList.contains("pk-btn--primary")).toBe(true);
    await click(restore);
    expect(registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")?.body)).toEqual({
      action: "update",
    });
  });

  it("claims offered day spots from the read view", async () => {
    const requests = installApi(
      readResponse({
        dayWaitlist: [
          {
            dayDate: "2026-12-01",
            status: "offered",
            priorityLane: "general",
            offerExpiresAt: "2026-12-02T10:00:00.000Z",
          },
        ],
      }),
    );
    const container = await mount();

    await click(button(container, "Claim place"));
    expect(registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")?.body)).toEqual({
      action: "update",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      claimDayWaitlistOffers: ["2026-12-01"],
    });
  });
  it("groups identical confirmed days into one line and marks a waiting day apart", async () => {
    const day = readResponse().eventDays[0]!;
    installApi(
      readResponse({
        eventDays: [day, { ...day, dayDate: "2026-12-02" }, { ...day, dayDate: "2026-12-03" }],
        dayAttendance: [
          { dayDate: "2026-12-01", attendanceType: "in_person", label: null },
          { dayDate: "2026-12-02", attendanceType: "in_person", label: null },
          { dayDate: "2026-12-03", attendanceType: "in_person", label: null },
        ],
        dayWaitlist: [{ dayDate: "2026-12-03", status: "waiting", priorityLane: "general", offerExpiresAt: null }],
      }),
    );
    const container = await mount();
    const rows = [...container.querySelectorAll<HTMLElement>(".pk-day-status__row")];
    expect(rows.map((row) => row.dataset.kind)).toEqual(["waiting", "confirmed"]);
    expect(rows[0]!.textContent).toContain("On the waiting list: In-person");
  });

  it("keeps a waiting day in the queue when the days are saved unchanged", async () => {
    const day = readResponse().eventDays[0]!;
    const requests = installApi(
      readResponse({
        eventDays: [day, { ...day, dayDate: "2026-12-02" }],
        dayAttendance: [
          { dayDate: "2026-12-01", attendanceType: "in_person", label: null },
          { dayDate: "2026-12-02", attendanceType: "in_person", label: null },
        ],
        dayWaitlist: [{ dayDate: "2026-12-02", status: "waiting", priorityLane: "general", offerExpiresAt: null }],
      }),
    );
    const container = await mount();
    await click(button(container, "Change my days"));
    await act(async () => {
      container
        .querySelector("form.pk-reg-days__form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    // In-person stays selected for the waiting day, which the server keeps at its queue position.
    expect(registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")?.body)).toMatchObject({
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
    });
  });

  it("confirms released seats once, preserves the draft on refusal, and keeps other days", async () => {
    const day = readResponse().eventDays[0]!;
    const requests = installApi(
      readResponse({
        eventDays: [day, { ...day, dayDate: "2026-12-02" }],
        dayAttendance: [
          { dayDate: "2026-12-01", attendanceType: "in_person", label: null },
          { dayDate: "2026-12-02", attendanceType: "in_person", label: null },
        ],
      }),
    );
    const container = await mount();
    await click(button(container, "Change my days"));
    await click(container.querySelector('input[name="dayAttendance.2026-12-01"][value="on_demand"]'));
    await click(button(container, "Save my days"));
    expect(openConfirmation()?.textContent).toContain("waiting list");
    expect(openConfirmation()?.textContent).toContain("Dec 1");
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
    await click(confirmationButton("Keep editing"));
    expect(
      container.querySelector<HTMLInputElement>('input[name="dayAttendance.2026-12-01"][value="on_demand"]')?.checked,
    ).toBe(true);
    await click(button(container, "Save my days"));
    await click(confirmationButton("Release seats and save"));
    await settle();
    expect(registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")?.body)).toEqual({
      action: "update",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "on_demand" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
    });
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  });

  it("uses the same seat-release confirmation when attendance changes in the full editor", async () => {
    const requests = installApi();
    const container = await mount();
    await click(button(container, "Edit details"));
    await click(container.querySelector('input[name="dayAttendance.2026-12-01"][value="on_demand"]'));
    await click(button(container, "Save changes"));
    expect(openConfirmation()?.textContent).toContain("waiting list");
    await click(confirmationButton("Keep editing"));
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[value="on_demand"]')?.checked).toBe(true);
    await click(button(container, "Save changes"));
    await click(confirmationButton("Release seats and save"));
    expect(
      registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")?.body).dayAttendance,
    ).toEqual([{ dayDate: "2026-12-01", attendanceType: "on_demand" }]);
  });

  it("confirms releasing a custom physical option", async () => {
    const day = readResponse().eventDays[0]!;
    const requests = installApi(
      readResponse({
        eventDays: [
          {
            ...day,
            attendanceOptions: [
              { value: "moon_base", label: "Moon base", accessMode: "physical" },
              { value: "live_lounge", label: "Live lounge", accessMode: "remote" },
            ],
          },
        ],
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "moon_base", optionLabel: "Moon base", label: null }],
      }),
    );
    const container = await mount();
    await click(button(container, "Change my days"));
    await click(container.querySelector('input[name="dayAttendance.2026-12-01"][value="live_lounge"]'));
    await click(button(container, "Save my days"));
    expect(openConfirmation()?.textContent).toContain("waiting list");
    await click(confirmationButton("Release seats and save"));
    await settle();
    expect(registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")?.body)).toEqual({
      action: "update",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "live_lounge" }],
    });
  });

  it.each(["days", "details"])(
    "treats giving up the only day as cancelling from the %s editor, behind the same confirmation",
    async (editor) => {
      const data = readResponse();
      const requests = installApi(data, {
        forms: eventFormsResponseSchema.parse({ ...FORMS, eventDays: data.eventDays }),
      });
      const container = await mount();

      if (editor === "days") {
        await click(button(container, "Change my days"));
        await click(container.querySelector('input[name="dayAttendance.2026-12-01"][value=""]'));
        await click(button(container, "Save my days"));
      } else {
        await click(button(container, "Edit details"));
        await click(container.querySelector<HTMLInputElement>('input[name^="dayAttendance."][value=""]'));
        await act(() => {
          container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });
      }
      await settle();
      expect(openConfirmation()?.textContent).toContain("Cancel your registration?");
      await click(confirmationButton("Keep registration"));
      expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
    },
  );

  // A speaker whose registration the talk's acceptance created has answered
  // none of the event's questions. Saving the details asks them, on the
  // question itself, rather than failing with a request-level 400.
  const countryQuestion = eventFormsResponseSchema.parse({
    ...FORMS,
    form: {
      ...FORMS.form,
      fields: [{ ...FORMS.form!.fields[0], key: "country", label: "Country", required: true }],
    },
  });

  async function submitDetails(container: HTMLElement): Promise<void> {
    await click(button(container, "Edit details"));
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  it("marks an unanswered required question on the question and sends nothing", async () => {
    const requests = installApi(
      readResponse({ registration: { ...readResponse().registration, custom_answers: null } }),
      {
        forms: countryQuestion,
      },
    );
    const container = await mount();

    await submitDetails(container);

    expect(container.querySelector('[data-field-error="country"]')?.textContent).toBe("Country is required");
    expect(container.querySelector("#custom-country")?.getAttribute("aria-invalid")).toBe("true");
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
  });

  it("puts the server's refusal of a question on that question, with its sentence above the form", async () => {
    installApi(readResponse({ registration: { ...readResponse().registration, custom_answers: { country: "NL" } } }), {
      forms: countryQuestion,
      refusePatch: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Answer the highlighted questions.",
          details: { fieldErrors: { country: ["Country must be a country code"] } },
        },
      },
    });
    const container = await mount();

    await submitDetails(container);
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Answer the highlighted questions.");
    expect(container.querySelector('[data-field-error="country"]')?.textContent).toBe("Country must be a country code");
  });
});
