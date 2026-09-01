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
    expect(hrefs).toContain(`#/events/${SLUG}/registrations/detail/${REGISTRATION_ID}`);
  });

  it("names itself and each of its tables for assistive technology", () => {
    mount(<AttendanceChangeDashboard slug={SLUG} changes={changes()} />);

    // The panel is an h2, so it nests as a sibling of the other event-dashboard
    // sections rather than inventing a rung in the page outline.
    const headings = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    expect(headings.map((node) => [node.tagName, node.textContent])).toEqual([["H2", "Attendance movement"]]);

    // Three tables on one surface are only tellable apart by their captions.
    const captions = [...container.querySelectorAll("caption")].map((node) => node.textContent);
    expect(captions).toEqual(["Where attendance changed", "How attendance changed", "Recent attendee changes"]);
    for (const caption of container.querySelectorAll("caption")) {
      expect(caption.classList.contains("pk-table__caption--hidden")).toBe(false);
    }

    // Every column header is a real th with a scope, so a cell can be related
    // back to the column it belongs to.
    const headers = [...container.querySelectorAll("th")];
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((header) => header.getAttribute("scope") === "col")).toBe(true);
    expect(headers.map((header) => header.textContent)).toContain("No longer in-person");
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

  it("says each table is empty when the totals arrive without their detail rows", () => {
    // A truncated or partially failed analytics query can report a headline
    // count with no supporting rows. Rendering three captioned tables with
    // empty bodies would look like a working surface reporting nothing.
    mount(<AttendanceChangeDashboard slug={SLUG} changes={changes({ byDay: [], byTransition: [], recent: [] })} />);

    const announcements = [...container.querySelectorAll(".pk-table__empty")].map((node) => node.textContent);
    expect(announcements).toEqual([
      "No event day has recorded a change yet.",
      "No transition has been recorded yet.",
      "No recent change to show.",
    ]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    // The overall figures are not silently zeroed to match the missing rows.
    expect(statValues()["Attendees changed"]).toBe("5");
  });

  it("keeps a multi-day change legible and falls back to the identifier it has", () => {
    mount(
      <AttendanceChangeDashboard
        slug={SLUG}
        changes={changes({
          recent: [
            {
              registration_id: REGISTRATION_ID,
              changed_at: "2026-05-20T09:30:00.000Z",
              from_type: "in_person",
              to_type: "on_demand",
              user_email: null,
              display_name: null,
              days: [{ day_date: "2026-06-03", label: null }],
            },
          ],
        })}
      />,
    );

    const text = container.textContent ?? "";
    // With neither a name nor an address the row still identifies its
    // registration rather than rendering an empty link.
    expect(text).toContain(REGISTRATION_ID);
    // An unlabelled day falls back to its date, and the transition is spelled
    // out in the event's own vocabulary.
    expect(text).toContain("2026-06-03");
    expect(text).toContain("In-person → On-demand");
  });
});
