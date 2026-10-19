// @vitest-environment jsdom
/**
 * The viewer's own standing for an event, as the Home panel and the events
 * overview render it.
 *
 * When a record address is available, the row is a single link. An expected
 * registration reads as plain text rather than a green pill; only a wait for
 * a seat is flagged. What is asserted here is that wording, that every
 * fragment is inside the one link, that each day names how it is attended
 * rather than the registration-level type, and that a viewer with no days at
 * all still renders.
 */
import { render, type ComponentChild, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventViewerStateSchema, type EventViewerState } from "../../assets/shared/schemas/event-management";
import { ViewerEventState } from "../../assets/ts/member-flows/portal/sections/events/ViewerEventState";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

/** Parsed through the shared schema, so a fixture cannot drift from the contract. */
function viewer(overrides: Record<string, unknown> = {}): EventViewerState {
  return eventViewerStateSchema.parse({
    registrationStatus: "registered",
    attendanceType: "in_person",
    waitlisted: false,
    holdsWorkAddress: true,
    days: [
      { date: "2026-10-03", attendanceType: "virtual", state: "registered" },
      { date: "2026-10-01", attendanceType: "in_person", state: "waitlisted" },
      { date: "2026-10-02", attendanceType: "in_person", state: "waitlisted" },
    ],
    ...overrides,
  });
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("viewer event state", () => {
  it("says an expected registration in words and flags only the wait for a seat", () => {
    const row = mount(<ViewerEventState viewer={viewer()} />);

    expect(row.querySelector(".pk-collection-status__fact")?.textContent).toMatch(
      /^You're registered \(virtual (3 Oct|Oct 3)\)$/,
    );
    const badges = [...row.querySelectorAll(".pk-badge")];
    expect(badges).toHaveLength(1);
    expect(badges[0]?.className).toContain("pk-badge--info");
    expect(badges[0]?.textContent).toMatch(/^Waitlisted in person/);
    expect(row.querySelector(".pk-badge--ok")).toBeNull();
  });

  it("keeps every fragment inside the one link, so the row has a single target", () => {
    const row = mount(<ViewerEventState viewer={viewer()} href="/events/pqc/registration" />);

    const links = row.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("#/events/pqc/registration");
    // The badge and every day are announced as part of the link's own name
    // rather than sitting loose beside it.
    // The month/day order is the runtime locale's to choose, so the day is
    // matched either way round; what the assertion pins is which day it is.
    expect(links[0].textContent).toMatch(/virtual (3 Oct|Oct 3)/);
    expect(links[0].textContent).toMatch(/Waitlisted in person (1|Oct 1)\s*–\s*(2 Oct|2)/);
  });

  it("never calls a virtual day in person because the registration has an in-person day", () => {
    const row = mount(<ViewerEventState viewer={viewer()} />);

    // The registration-level type is "in_person" only because the waitlisted days are.
    expect(row.textContent).not.toContain("In person");
    expect(row.textContent).not.toContain("Days:");
  });

  it("renders day dates as calendar days, never shifted by the viewer's zone", () => {
    const row = mount(
      <ViewerEventState
        viewer={viewer({ days: [{ date: "2026-01-01", attendanceType: "in_person", state: "registered" }] })}
      />,
    );

    // A date-only value read as a local instant slips to 31 Dec west of UTC.
    expect(row.textContent).toMatch(/in person (1 Jan|Jan 1)/);
    expect(row.textContent).not.toContain("Dec");
  });

  it("renders a viewer with no recorded days rather than failing on the empty list", () => {
    const row = mount(<ViewerEventState viewer={viewer({ days: [], waitlisted: false })} />);

    // Without days the registration's type covers the whole event.
    expect(row.textContent).toBe("You're registered (in person)");
    expect(row.querySelector(".pk-badge")).toBeNull();
    expect(row.querySelector("a")).toBeNull();
  });
});
