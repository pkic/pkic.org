// @vitest-environment jsdom
/**
 * The attendee's own registration page in the portal.
 *
 * It opened as a form with "Save changes" and "Cancel registration" side by
 * side, and "Cancel registration" read as "go back without saving". What is
 * asserted here is the separation the page now keeps: it opens read-only,
 * editing is an explicit command whose way out is "Discard changes", each
 * day carries its own change (an in-person seat leads with "Can't make it in
 * person?"), and cancelling sits apart at the end behind the shared
 * confirmation.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventFormsResponseSchema } from "../../assets/shared/schemas/forms";
import {
  registrationManageReadResponseSchema,
  registrationManageSchema,
  type RegistrationManageReadResponse,
} from "../../assets/shared/schemas/registration";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { ParticipantRegistration } from "../../assets/ts/components/events/ParticipantRegistration";
import { confirmationButton, openConfirmation } from "./helpers/confirm-dialog";

const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = `/api/v1/registrations/${REGISTRATION_ID}`;
const EVENT = { id: "event-1", slug: "pqc-2026", name: "PQC Conference" };

function readResponse(overrides: Partial<RegistrationManageReadResponse> = {}): RegistrationManageReadResponse {
  return registrationManageReadResponseSchema.parse({
    success: true,
    sponsorSharing: { allowed: false, withdrawnAt: null },
    registration: {
      id: REGISTRATION_ID,
      event_id: EVENT.id,
      status: "registered",
      cancellation_reason_code: null,
      attendance_type: "in_person",
      custom_answers: { dietary: "Vegetarian" },
      isEmailVerified: true,
    },
    identityId: null,
    event: EVENT,
    user: {
      email: "ada@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      organization_name: "Analytical Engines",
      job_title: "Engineer",
    },
    eventDays: [
      {
        dayDate: "2026-12-01",
        label: "Day 1",
        inPersonCapacity: 10,
        sortOrder: 1,
        attendanceOptions: [
          { value: "in_person", label: "In person" },
          { value: "on_demand", label: "On demand" },
        ],
      },
    ],
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" }],
    dayWaitlist: [],
    shareUrl: null,
    headshotUrl: null,
    ...overrides,
  });
}

const FORMS = eventFormsResponseSchema.parse({
  event: EVENT,
  registrationPolicy: "optional",
  purpose: "event_registration",
  form: {
    id: "22222222-2222-4222-8222-222222222222",
    key: "registration",
    title: "Registration",
    description: null,
    fields: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        key: "dietary",
        label: "Dietary requirements",
        fieldType: "text",
        required: false,
        options: null,
        optionSource: null,
        validation: null,
        sortOrder: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
      },
    ],
  },
  requiredTerms: [],
  allowedSessionTypes: [],
  eventDays: [],
});

const mounted: HTMLElement[] = [];

function installApi(read: RegistrationManageReadResponse = readResponse()) {
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
      if (method === "GET" && url.pathname.endsWith("/forms/placements/event_registration")) return json(FORMS);
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
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label) ?? null;
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
});

describe("ParticipantRegistration", () => {
  it("opens read-only, with the registration's details as a description list", async () => {
    installApi();
    const container = await mount();

    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(facts(container)).toMatchObject({
      Name: "Ada Lovelace",
      "Email address": "ada@example.test",
      Organization: "Analytical Engines",
      "Job title": "Engineer",
      "Dietary requirements": "Vegetarian",
    });
    // The confirmed-days summary already states each day; the fact list does not repeat it.
    expect(facts(container)).not.toHaveProperty("Day 1");
    expect(button(container, "Edit details")?.classList.contains("pk-btn--primary")).toBe(true);
    expect(button(container, "Save changes")).toBeNull();
    // Each day is a card with its state in words and the change it allows.
    // The shared day summary states the days in words, grouped by what they amount to.
    const summary = container.querySelector('[aria-label="Your registration, day by day"]');
    expect(summary?.textContent).toContain("In-person");
    expect(button(container, "Can't make it in person?")).not.toBeNull();
    // Cancelling is findable on the page, set apart and quiet, never the main action.
    expect(button(container, "Cancel my registration…")?.classList.contains("pk-btn--danger-quiet")).toBe(true);
  });

  it("swaps the read view for the form on Edit, and Discard resets the draft and returns", async () => {
    const requests = installApi();
    const container = await mount();

    await click(button(container, "Edit details"));
    const jobTitle = container.querySelector<HTMLInputElement>('input[name="jobTitle"]');
    expect(jobTitle?.value).toBe("Engineer");
    expect(button(container, "Save changes")?.type).toBe("submit");
    expect(button(container, "Save changes")?.classList.contains("pk-btn--primary")).toBe(true);
    expect(button(container, "Discard changes")).not.toBeNull();
    expect(button(container, "Cancel my registration…")).toBeNull();

    await act(async () => {
      jobTitle!.value = "Countess";
      jobTitle!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button(container, "Discard changes"));

    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(facts(container)["Job title"]).toBe("Engineer");
    await click(button(container, "Edit details"));
    expect(container.querySelector<HTMLInputElement>('input[name="jobTitle"]')?.value).toBe("Engineer");
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
  });

  it("saves through the shared contract and returns to the read view with the outcome", async () => {
    const requests = installApi();
    const container = await mount();

    await click(button(container, "Edit details"));
    const jobTitle = container.querySelector<HTMLInputElement>('input[name="jobTitle"]');
    await act(async () => {
      jobTitle!.value = "Countess";
      jobTitle!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    await settle();

    const patch = requests.find(({ method }) => method === "PATCH");
    expect(registrationManageSchema.parse(patch?.body)).toMatchObject({ action: "update", jobTitle: "Countess" });
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(container.textContent).toContain("Registration updated.");
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

    await click(button(container, "Claim seat"));
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
    expect(rows[0]!.textContent).toContain("On the waiting list for an in-person seat");
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

  it("releases chosen in-person days through the guided dialog, keeping the other days", async () => {
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

    await click(button(container, "Can't make it in person?"));
    const dialog = openConfirmation()!;
    const confirm = () => [...dialog.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Release"));
    expect(confirm()?.disabled).toBe(true);
    await click(dialog.querySelector<HTMLInputElement>('input[name="releaseDay"][value="2026-12-01"]'));
    await click(dialog.querySelector<HTMLInputElement>('input[name="joinInstead"][value="on_demand"]'));
    expect(confirm()?.disabled).toBe(false);
    await click(confirm()!);
    await settle();

    expect(registrationManageSchema.parse(requests.find(({ method }) => method === "PATCH")?.body)).toEqual({
      action: "update",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "on_demand" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
    });
  });

  it("treats giving up the only day as cancelling, behind the cancellation confirmation", async () => {
    const requests = installApi();
    const container = await mount();

    await click(button(container, "Can't make it in person?"));
    const dialog = openConfirmation()!;
    await click(dialog.querySelector<HTMLInputElement>('input[name="joinInstead"][value=""]'));
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Release"))!);
    await settle();
    expect(openConfirmation()?.textContent).toContain("Cancel your registration?");
    await click(confirmationButton("Keep registration"));
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
  });
});
