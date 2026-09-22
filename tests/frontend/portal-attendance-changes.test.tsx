// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttendanceChangeDashboard } from "../../assets/ts/member-flows/portal/sections/events/detail/AttendanceChangeDashboard";
import type { EventAnalyticsResponse } from "../../assets/shared/schemas/event-analytics";

type AttendanceChanges = EventAnalyticsResponse["attendanceChanges"];

const SLUG = "pqc-2026";
const REGISTRATION_ID = "30000000-0000-4000-8000-000000000001";

let container: HTMLDivElement;

function mount(node: ComponentChildren): void {
  void act(() => render(node, container));
}

/** Nothing has moved yet — the shape the analytics endpoint returns on day one. */
function noChanges(): AttendanceChanges {
  return {
    totalChanges: 0,
    changedRegistrations: 0,
    dayChanges: 0,
    changedAttendees: 0,
    leftInPersonAttendees: 0,
    leftInPersonDayChanges: 0,
    joinedInPersonAttendees: 0,
    joinedInPersonDayChanges: 0,
    byTransition: [],
    byDay: [],
    recent: [],
  };
}

function changes(overrides: Partial<AttendanceChanges> = {}): AttendanceChanges {
  return {
    ...noChanges(),
    totalChanges: 7,
    changedRegistrations: 5,
    dayChanges: 7,
    changedAttendees: 5,
    leftInPersonAttendees: 3,
    leftInPersonDayChanges: 4,
    joinedInPersonAttendees: 2,
    joinedInPersonDayChanges: 3,
    byTransition: [{ from_type: "in_person", to_type: "virtual", attendees: 3, day_changes: 4 }],
    byDay: [
      {
        day_date: "2026-06-01",
        label: "Day one",
        sort_order: 1,
        changed_attendees: 5,
        day_changes: 7,
        left_in_person_attendees: 3,
        joined_in_person_attendees: 2,
      },
    ],
    recent: [
      {
        registration_id: REGISTRATION_ID,
        changed_at: "2026-05-20T09:30:00.000Z",
        from_type: "in_person",
        to_type: "virtual",
        user_email: "mover@example.test",
        display_name: "Ada Mover",
        days: [
          { day_date: "2026-06-01", label: "Day one" },
          { day_date: "2026-06-02", label: "Day two" },
        ],
      },
    ],
    ...overrides,
  };
}

function statValues(): Record<string, string | undefined> {
  const entries = [...container.querySelectorAll(".pk-stat-card")].map(
    (card) =>
      [
        card.querySelector(".pk-stat-card__label")?.textContent ?? "",
        card.querySelector(".pk-stat-card__value")?.textContent ?? undefined,
      ] as const,
  );
  return Object.fromEntries(entries);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
});

describe("portal attendance movement dashboard", () => {
  it("reports every headline figure and drills into the matching registration list", () => {
    mount(<AttendanceChangeDashboard slug={SLUG} changes={changes()} />);

    expect(statValues()).toEqual({
      "Attendees changed": "5",
      "No longer in-person": "3",
      "Now in-person": "2",
      "Day changes": "7",
    });

    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(`#/events/${SLUG}/registrations/attendance-changed`);
    expect(hrefs).toContain(`#/events/${SLUG}/registrations/left-in-person`);
    expect(hrefs).toContain(`#/events/${SLUG}/registrations/joined-in-person`);
    expect(container.querySelector(".pk-table--data")).toBeNull();
  });

  it("names its chart and exposes the same values to assistive technology", () => {
    mount(<AttendanceChangeDashboard slug={SLUG} changes={changes()} />);
    expect(container.querySelector('figure[aria-label="Where attendance changed"]')).not.toBeNull();
    expect(container.querySelector("caption")?.textContent).toBe("Where attendance changed");
    expect(container.querySelector('[aria-label="How attendance changed"]')?.textContent).toContain(
      "In-person → Virtual",
    );
    expect(container.querySelector(".pk-table--data")).toBeNull();
  });

  it("states the direction of movement in words, not by colour alone", () => {
    mount(<AttendanceChangeDashboard slug={SLUG} changes={changes()} />);

    const text = container.textContent ?? "";
    // The direction lives in the card labels, the notes and the link text, so
    // nothing about the figure depends on separating amber from green.
    expect(text).toContain("No longer in-person");
    expect(text).toContain("4 moves from in-person");
    expect(text).toContain("Now in-person");
    expect(text).toContain("3 moves to in-person");
    expect(text).toContain("Attendees who left in-person");
    expect(text).toContain("Attendees who joined in-person");
    // No card is tinted to carry meaning a reader might not perceive.
    expect(container.querySelector('[class*="pk-stat-card__note--"]')).toBeNull();
  });

  it("replaces the tables with an explanation when nothing has moved", () => {
    mount(<AttendanceChangeDashboard slug={SLUG} changes={noChanges()} />);

    const empty = container.querySelector(".pk-empty-state");
    expect(empty?.textContent).toContain("No attendees have changed attendance after registration.");
    expect(empty?.closest('[role="status"]')).not.toBeNull();
    expect(container.querySelector("table")).toBeNull();

    // The headline figures are still shown, all reading zero.
    expect(statValues()).toEqual({
      "Attendees changed": "0",
      "No longer in-person": "0",
      "Now in-person": "0",
      "Day changes": "0",
    });
  });

  it("reports missing breakdown data without zeroing the headline totals", () => {
    mount(<AttendanceChangeDashboard slug={SLUG} changes={changes({ byDay: [], byTransition: [], recent: [] })} />);
    expect(container.textContent).toContain("No data");
    expect(statValues()["Attendees changed"]).toBe("5");
    expect(container.querySelector("table")).toBeNull();
  });
});
