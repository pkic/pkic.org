// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrationManageSchema } from "../../assets/shared/schemas/registration";
import { confirmationButton, openConfirmation } from "./helpers/confirm-dialog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The manage read the page boots from, with one offered in-person day. */
function manageResponse(): Response {
  return jsonResponse({
    success: true,
    sponsorSharing: { allowed: false, withdrawnAt: null },
    registration: {
      id: "00000000-0000-0000-0000-000000000000",
      event_id: "event-1",
      status: "registered",
      cancellation_reason_code: null,
      attendance_type: "in_person",
      custom_answers: null,
      isEmailVerified: true,
    },
    event: { id: "event-1", slug: "pqc-2026", name: "PQC Conference" },
    user: {
      id: "user-1",
      email: "claim@example.test",
      first_name: "Casey",
      last_name: "Claim",
      organization_name: null,
      job_title: null,
    },
    eventDays: [
      {
        dayDate: "2026-12-01",
        label: "Day 1",
        inPersonCapacity: 1,
        sortOrder: 1,
        attendanceOptions: [{ value: "in_person", label: "In-person" }],
      },
    ],
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" }],
    dayWaitlist: [
      {
        dayDate: "2026-12-01",
        status: "offered",
        priorityLane: "general",
        offerExpiresAt: "2026-12-01T10:00:00.000Z",
      },
    ],
    shareUrl: null,
    headshotUrl: null,
  });
}

/** The manage page markup and address the module boots from, freshly imported. */
function installManagePage(): void {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/pqc-2026/register/manage/");
  document.body.innerHTML = `
    <main
      data-event-registration-manage
      data-event-slug="pqc-2026"
      data-api-base="/api/v1"
      data-manage-token="claim-token"
    >
      <div data-manage-loading></div>
      <div data-manage-status-banner hidden></div>
      <div data-manage-greeting hidden>
        <span data-manage-greeting-text></span><span data-manage-status-badge></span>
      </div>
      <div data-manage-form hidden>
        <section data-day-waitlist-section hidden><div data-day-waitlist></div></section>
        <div data-manage-summary></div>
        <form hidden>
          <input name="email"><input name="firstName"><input name="lastName">
          <input name="organizationName"><input name="jobTitle">
          <div data-day-attendance></div>
          <section data-custom-fields-section><div data-custom-fields></div></section>
          <div data-action-buttons>
            <button type="submit">Save changes</button>
            <button type="button" data-action="discard">Discard changes</button>
          </div>
        </form>
        <div data-flow-status></div>
      </div>
      <section data-post-action hidden>
        <div data-post-action-alert><h2 data-post-action-title></h2><p data-post-action-message></p></div>
      </section>
    </main>`;
}

describe("registration waitlist claim UI", () => {
  beforeEach(installManagePage);

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the manage form visible and never shows success when a claim returns 409", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        return jsonResponse(
          {
            error: {
              code: "DAY_WAITLIST_OFFER_UNAVAILABLE",
              message: "This offered spot is no longer available. Refresh and try again.",
            },
          },
          409,
        );
      }
      if (url.includes("/forms?")) return jsonResponse({ error: { code: "NOT_FOUND", message: "No form" } }, 404);
      return jsonResponse({
        success: true,
        sponsorSharing: { allowed: false, withdrawnAt: null },
        registration: {
          id: "00000000-0000-0000-0000-000000000000",
          event_id: "event-1",
          status: "registered",
          cancellation_reason_code: null,
          attendance_type: "in_person",
          custom_answers: null,
          isEmailVerified: true,
        },
        event: { id: "event-1", slug: "pqc-2026", name: "PQC Conference" },
        user: {
          id: "user-1",
          email: "claim@example.test",
          first_name: "Casey",
          last_name: "Claim",
          organization_name: null,
          job_title: null,
        },
        eventDays: [
          {
            dayDate: "2026-12-01",
            label: "Day 1",
            inPersonCapacity: 1,
            sortOrder: 1,
            attendanceOptions: [{ value: "in_person", label: "In-person" }],
          },
        ],
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" }],
        dayWaitlist: [
          {
            dayDate: "2026-12-01",
            status: "offered",
            priorityLane: "general",
            offerExpiresAt: "2026-12-01T10:00:00.000Z",
          },
        ],
        shareUrl: null,
        headshotUrl: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("../../assets/ts/event-flows/registration-manage-page");
    const claimButton = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("[data-day-waitlist] button");
      expect(button).not.toBeNull();
      return button!;
    });

    claimButton.click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-flow-status]")?.textContent).toContain("no longer available");
    });
    expect(document.querySelector<HTMLElement>("[data-manage-form]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-post-action]")?.hidden).toBe(true);
    expect(document.querySelector("[data-post-action-title]")?.textContent).not.toContain("claimed");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/registrations/access/claim-token",
      expect.objectContaining({ method: "PATCH" }),
    );
    // Parsed through the shared request schema rather than compared to a
    // literal, so the case follows the contract as it moves.
    const patched = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    const body = registrationManageSchema.parse(JSON.parse(String((patched?.[1] as RequestInit).body)));
    expect(body.action).toBe("update");
    expect(body.claimDayWaitlistOffers).toEqual(["2026-12-01"]);
  });

  it("says each day's state in words and dresses it with the design system only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(manageResponse())),
    );

    await import("../../assets/ts/event-flows/registration-manage-page");
    await vi.waitFor(() => {
      expect(document.querySelector("[data-manage-status-banner] dl.pk-datalist")).not.toBeNull();
    });

    const banner = document.querySelector<HTMLElement>("[data-manage-status-banner]");
    expect(banner?.hidden).toBe(false);
    // A day and its state are a term and its value, so each value is
    // announced with the term that names it.
    expect([...(banner?.querySelectorAll("dt") ?? [])].map((term) => term.textContent)).toEqual(["Day 1"]);
    const badge = banner?.querySelector("dd .pk-badge");
    expect(badge?.textContent).toBe("Spot available");
    expect(badge?.classList.contains("pk-badge--info")).toBe(true);

    for (const element of banner?.querySelectorAll<HTMLElement>("*") ?? []) {
      for (const name of element.classList) expect(name === "pk" || name.startsWith("pk-")).toBe(true);
    }
  });

  it("keeps the waitlist chips and the claim control in the design system's vocabulary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(manageResponse())),
    );

    await import("../../assets/ts/event-flows/registration-manage-page");
    const claimButton = await vi.waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>("[data-day-waitlist] button");
      expect(button).not.toBeNull();
      return button!;
    });

    expect(claimButton.className).toBe("pk-btn pk-btn--sm pk-btn--primary");
    const chip = document.querySelector("[data-day-waitlist] .pk-badge");
    // The chip spells the state out; the tone only agrees with the words.
    expect(chip?.textContent).toContain("In-person spot available");
    expect(chip?.classList.contains("pk-badge--info")).toBe(true);
  });

  it("links the attendee's own portal agenda beside the greeting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(manageResponse())),
    );

    await import("../../assets/ts/event-flows/registration-manage-page");
    const link = await vi.waitFor(() => {
      const found = document.querySelector<HTMLAnchorElement>("[data-manage-greeting] a[data-manage-agenda-link]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(link.textContent).toBe("My agenda");
    expect(link.getAttribute("href")).toBe("/portal/#/events/pqc-2026/agenda?mine=1");
  });
});

/** A button on the page by its visible words. */
function buttonReading(label: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label) ?? null
  );
}

/** The manage page booted against `fetchMock`, once its read view is on screen. */
async function bootReadView(fetchMock: ReturnType<typeof vi.fn>): Promise<HTMLFormElement> {
  vi.stubGlobal("fetch", fetchMock);
  await import("../../assets/ts/event-flows/registration-manage-page");
  await vi.waitFor(() => expect(buttonReading("Edit details")).not.toBeNull());
  return document.querySelector<HTMLFormElement>("[data-manage-form] form")!;
}

function patchBodies(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => registrationManageSchema.parse(JSON.parse(String((init as RequestInit).body))));
}

describe("registration manage read view", () => {
  beforeEach(installManagePage);

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function okFetch() {
    return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PATCH"
        ? jsonResponse({ success: true, emailChanged: false, sponsorSharing: { allowed: false, withdrawnAt: null } })
        : manageResponse(),
    );
  }

  it("opens on the registration's details, with the form hidden until Edit details", async () => {
    const form = await bootReadView(okFetch());

    expect(form.hidden).toBe(true);
    const summary = document.querySelector<HTMLElement>("[data-manage-summary]");
    expect(summary?.hidden).toBe(false);
    const terms = [...(summary?.querySelectorAll("dt") ?? [])].map((term) => term.textContent);
    expect(terms).toEqual(expect.arrayContaining(["Name", "Email address", "Day 1"]));
    expect(summary?.textContent).toContain("Casey Claim");

    buttonReading("Edit details")!.click();
    expect(form.hidden).toBe(false);
    expect(summary?.hidden).toBe(true);
    expect(buttonReading("Save changes")?.type).toBe("submit");
    // The edit view offers no way to cancel the registration: its commands are Save and Discard only.
    expect([...form.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual([
      "Save changes",
      "Discard changes",
    ]);
    expect(buttonReading("Cancel my registration…")?.closest("[hidden]")).toBe(summary);
  });

  it("discards an edit by restoring the loaded values and returning to the read view", async () => {
    const fetchMock = okFetch();
    const form = await bootReadView(fetchMock);

    buttonReading("Edit details")!.click();
    const firstName = form.querySelector<HTMLInputElement>('input[name="firstName"]')!;
    expect(firstName.value).toBe("Casey");
    firstName.value = "Someone else";
    buttonReading("Discard changes")!.click();

    expect(form.hidden).toBe(true);
    expect(firstName.value).toBe("Casey");
    expect(patchBodies(fetchMock)).toEqual([]);
  });

  it("cancels only after the shared confirmation, and Keep registration sends nothing", async () => {
    const fetchMock = okFetch();
    await bootReadView(fetchMock);

    buttonReading("Cancel my registration…")!.click();
    await vi.waitFor(() => expect(openConfirmation()?.textContent).toContain("Cancel your registration?"));
    confirmationButton("Keep registration")!.click();
    await vi.waitFor(() => expect(openConfirmation()).toBeNull());
    expect(patchBodies(fetchMock)).toEqual([]);

    buttonReading("Cancel my registration…")!.click();
    await vi.waitFor(() => expect(confirmationButton("Cancel registration")).not.toBeNull());
    confirmationButton("Cancel registration")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-post-action-title]")?.textContent).toBe("Registration cancelled"),
    );
    expect(patchBodies(fetchMock)).toEqual([{ action: "cancel" }]);
  });

  it("reports an unauthorized registration only after the shared confirmation", async () => {
    const fetchMock = okFetch();
    await bootReadView(fetchMock);

    buttonReading("I did not request this registration…")!.click();
    await vi.waitFor(() => expect(openConfirmation()?.textContent).toContain("Notify the event organizer"));
    expect(patchBodies(fetchMock)).toEqual([]);
    confirmationButton("Report unauthorized registration")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-post-action-title]")?.textContent).toBe("Report received"),
    );
    expect(patchBodies(fetchMock)).toEqual([{ action: "report_unauthorized" }]);
  });
});
