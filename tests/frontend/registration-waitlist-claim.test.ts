// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrationManageSchema } from "../../assets/shared/schemas/registration";

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

describe("registration waitlist claim UI", () => {
  beforeEach(() => {
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
        <form data-manage-form hidden>
          <div data-flow-status></div>
          <input name="email"><input name="firstName"><input name="lastName">
          <input name="organizationName"><input name="jobTitle">
          <div data-day-attendance></div>
          <section data-day-waitlist-section hidden><div data-day-waitlist></div></section>
          <section data-custom-fields-section><div data-custom-fields></div></section>
          <div data-action-buttons>
            <button type="submit">Save</button><button type="button" data-action="cancel">Cancel</button>
          </div>
        </form>
        <section data-post-action hidden>
          <div data-post-action-alert><h2 data-post-action-title></h2><p data-post-action-message></p></div>
        </section>
        <section data-confirm-cancel hidden>
          <span data-confirm-event-name></span><button data-confirm-cancel-no></button><button data-confirm-cancel-yes></button>
        </section>
        <section data-confirm-unauthorized hidden>
          <button data-unauthorized-no></button><button data-unauthorized-yes></button>
        </section>
      </main>`;
  });

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
});
