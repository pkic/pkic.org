// @vitest-environment jsdom
/**
 * The viewer's own standing for an event, as the Home panel and the events
 * overview render it.
 *
 * The row is a link to Participation, so what it announces is what a reader
 * hears before deciding to follow it. The Bootstrap version put the status
 * behind `small text-muted` and spaced its fragments with `ms-2` margins; what
 * is asserted here is that the status is still a named badge rather than a
 * colour, that every fragment is inside the one link, and that a viewer with
 * no days at all still renders.
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
    days: [
      { date: "2026-10-03", state: "registered" },
      { date: "2026-10-04", state: "waitlisted" },
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
  it("names the registration status in the badge rather than leaving it to a tint", () => {
    const row = mount(<ViewerEventState viewer={viewer()} />);

    const badge = row.querySelector(".pk-badge");
    expect(badge?.textContent).toBe("Registered");
    expect(badge?.className).toContain("pk-badge--ok");
  });

  it("keeps every fragment inside the one link, so the row has a single target", () => {
    const row = mount(<ViewerEventState viewer={viewer()} />);

    const links = row.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("#/participation");
    // The badge, the attendance type and both day lists are all announced as
    // part of the link's own name rather than sitting loose beside it.
    expect(links[0].textContent).toContain("In person");
    // The month/day order is the runtime locale's to choose, so the day is
    // matched either way round; what the assertion pins is which day it is.
    expect(links[0].textContent).toMatch(/Days: (3 Oct|Oct 3)/);
    expect(links[0].textContent).toMatch(/Waitlisted: (4 Oct|Oct 4)/);
  });

  it("renders day dates as calendar days, never shifted by the viewer's zone", () => {
    const row = mount(<ViewerEventState viewer={viewer({ days: [{ date: "2026-01-01", state: "registered" }] })} />);

    // A date-only value read as a local instant slips to 31 Dec west of UTC.
    expect(row.textContent).toMatch(/Days: (1 Jan|Jan 1)/);
    expect(row.textContent).not.toContain("Dec");
  });

  it("badges an overall waitlist only when no day carries it", () => {
    const withDays = mount(<ViewerEventState viewer={viewer({ waitlisted: true })} />);
    expect(withDays.querySelectorAll(".pk-badge")).toHaveLength(1);

    void act(() => render(null, container!));
    const withoutDays = mount(<ViewerEventState viewer={viewer({ waitlisted: true, days: [] })} />);
    const badges = [...withoutDays.querySelectorAll(".pk-badge")].map((badge) => badge.textContent);
    expect(badges).toEqual(["Registered", "Waitlisted"]);
  });

  it("renders a viewer with no recorded days rather than failing on the empty list", () => {
    const row = mount(<ViewerEventState viewer={viewer({ days: [], waitlisted: false })} />);

    expect(row.textContent).not.toContain("Days:");
    expect(row.textContent).not.toContain("Waitlisted:");
    expect(row.querySelector(".pk-badge")?.textContent).toBe("Registered");
  });
});
