// @vitest-environment jsdom
/**
 * The registration cards as list filters: each card sets exactly the filters
 * that list the people it counts, and shows as pressed while they apply.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import {
  listFilters,
  RegistrationTotals,
  type RegistrationTotalsFilters,
} from "../../assets/ts/components/event-registrations/RegistrationTotals";
import type { EventAttendanceRegistrationsStats } from "../../assets/shared/schemas/event-registrations";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

const stats: EventAttendanceRegistrationsStats & { bouncedCount?: number } = {
  byAttendanceType: {},
  attendanceStatusByType: {
    in_person: { total: 12, accepted: 10, waitlisted: 2, expired: 0 },
    virtual: { total: 5, accepted: 5, waitlisted: 0, expired: 0 },
  },
  byStatus: { registered: 15, pending_email_confirmation: 1, cancelled: 3 },
  waitlistedCount: 2,
  bouncedCount: 1,
};

function filters(current: Record<string, string>, byAttendanceType = true) {
  const apply = vi.fn<RegistrationTotalsFilters["apply"]>();
  return { current, apply, byAttendanceType };
}

function toggle(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(
    (candidate) => candidate.textContent === name,
  );
  if (!button) throw new Error(`No toggle named "${name}"`);
  return button;
}

describe("RegistrationTotals filters", () => {
  it("filters an attendance card by its type and every status but cancelled, clearing other filters", () => {
    const list = filters({ country: "NL", waitlisted: "true" });
    const container = mount(<RegistrationTotals stats={stats} filters={list} />);
    const inPerson = toggle(container, "Show in-person only");
    expect(inPerson.getAttribute("aria-pressed")).toBe("false");
    void act(() => inPerson.click());
    expect(list.apply).toHaveBeenCalledWith({
      country: "",
      waitlisted: "",
      status: "registered,pending_email_confirmation",
      attendance_type: "in_person",
    });
  });

  it("shows the card as pressed only while exactly its filters apply, in any order", () => {
    const pressed = mount(
      <RegistrationTotals
        stats={stats}
        filters={filters({ attendance_type: "in_person", status: "pending_email_confirmation,registered" })}
      />,
    );
    expect(toggle(pressed, "Show in-person only").getAttribute("aria-pressed")).toBe("true");
    expect(pressed.querySelector(".pk-stat-card--pressed")?.textContent).toContain("In-person");
    expect(toggle(pressed, "Show all registrations").getAttribute("aria-pressed")).toBe("false");

    // The attendance filter alone keeps cancellations: not the card's population.
    const typeOnly = mount(<RegistrationTotals stats={stats} filters={filters({ attendance_type: "in_person" })} />);
    expect(toggle(typeOnly, "Show in-person only").getAttribute("aria-pressed")).toBe("false");
  });

  it("clears the card's filters when it is pressed again", () => {
    const list = filters({ attendance_type: "virtual", status: "registered,pending_email_confirmation" });
    const container = mount(<RegistrationTotals stats={stats} filters={list} />);
    void act(() => toggle(container, "Show virtual only").click());
    expect(list.apply).toHaveBeenCalledWith({ attendance_type: "", status: "" });
  });

  it("lists everyone from the registered card and bounced registrations from the bounced card", () => {
    const list = filters({ status: "cancelled" }, false);
    const container = mount(<RegistrationTotals stats={stats} filters={list} />);
    expect(toggle(container, "Show all registrations").getAttribute("aria-pressed")).toBe("false");
    void act(() => toggle(container, "Show all registrations").click());
    expect(list.apply).toHaveBeenLastCalledWith({ status: "" });
    void act(() => toggle(container, "Show bounced only").click());
    expect(list.apply).toHaveBeenLastCalledWith({ status: "", bounced: "true" });
  });

  it("leaves attendance cards as figures where the list cannot filter by attendance type", () => {
    const container = mount(<RegistrationTotals stats={stats} filters={filters({}, false)} />);
    expect(toggle(container, "Show all registrations").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(2);
  });

  it("renders figures without toggles when the list offers no filters", () => {
    const container = mount(<RegistrationTotals stats={stats} />);
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
  });
});

describe("listFilters", () => {
  it("keeps the column filters and drops search, sort and paging", () => {
    expect(listFilters({ q: "ada", sort: "-created_at", limit: "50", offset: "0", status: "registered" })).toEqual({
      status: "registered",
    });
  });
});
