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
import { AttendanceIcon } from "../../assets/ts/components/AttendanceIcon";
import type { EventAttendanceOption } from "../../assets/shared/schemas/event-configuration";

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
    in_person: { total: 12, accepted: 10, waitlisted: 2, expired: 0, pending: 1, cancelled: 2 },
    virtual: { total: 5, accepted: 5, waitlisted: 0, expired: 0, pending: 0, cancelled: 0 },
  },
  byStatus: { registered: 15, pending_email_confirmation: 1, cancelled: 3 },
  waitlistedCount: 2,
  bouncedCount: 1,
};

const options: EventAttendanceOption[] = [
  { value: "in_person", label: "In-person", icon: "location" },
  { value: "virtual", label: "Virtual" },
];

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
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} filters={list} />);
    const inPerson = toggle(container, "Show In-person only");
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
        attendanceOptions={options}
        filters={filters({ attendance_type: "in_person", status: "pending_email_confirmation,registered" })}
      />,
    );
    expect(toggle(pressed, "Show In-person only").getAttribute("aria-pressed")).toBe("true");
    expect(pressed.querySelector(".pk-stat-card--pressed")?.textContent).toContain("In-person");
    expect(toggle(pressed, "Show all registrations").getAttribute("aria-pressed")).toBe("false");

    // The attendance filter alone keeps cancellations: not the card's population.
    const typeOnly = mount(
      <RegistrationTotals
        stats={stats}
        attendanceOptions={options}
        filters={filters({ attendance_type: "in_person" })}
      />,
    );
    expect(toggle(typeOnly, "Show In-person only").getAttribute("aria-pressed")).toBe("false");
  });

  it("clears the card's filters when it is pressed again", () => {
    const list = filters({ attendance_type: "virtual", status: "registered,pending_email_confirmation" });
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} filters={list} />);
    void act(() => toggle(container, "Show Virtual only").click());
    expect(list.apply).toHaveBeenCalledWith({ attendance_type: "", status: "" });
  });

  it("lists everyone from the registered card and bounced registrations from the bounced card", () => {
    const list = filters({ status: "cancelled" }, false);
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} filters={list} />);
    expect(toggle(container, "Show all registrations").getAttribute("aria-pressed")).toBe("false");
    void act(() => toggle(container, "Show all registrations").click());
    expect(list.apply).toHaveBeenLastCalledWith({ status: "" });
    void act(() => toggle(container, "Show bounced only").click());
    expect(list.apply).toHaveBeenLastCalledWith({ status: "", bounced: "true" });
  });

  it("leaves attendance cards as figures where the list cannot filter by attendance type", () => {
    const container = mount(
      <RegistrationTotals stats={stats} attendanceOptions={options} filters={filters({}, false)} />,
    );
    expect(toggle(container, "Show all registrations").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(2);
  });

  it("renders figures without toggles when the list offers no filters", () => {
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} />);
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
  });
});

describe("RegistrationTotals attendance cards", () => {
  it("draws one card per configured option, in its order, wording and icon", () => {
    const configured: EventAttendanceOption[] = [
      { value: "virtual", label: "Watch online" },
      { value: "livestream_lounge", label: "Livestream Lounge", icon: "people" },
    ];
    const container = mount(
      <RegistrationTotals
        stats={{
          ...stats,
          attendanceStatusByType: {
            ...stats.attendanceStatusByType,
            livestream_lounge: { total: 3, accepted: 3, waitlisted: 0, expired: 0, pending: 0, cancelled: 0 },
          },
        }}
        attendanceOptions={configured}
      />,
    );
    const labels = [...container.querySelectorAll(".pk-stat-card__label")].map((label) => label.textContent);
    expect(labels).toEqual(["Registered", "Watch online", "Livestream Lounge", "Bounced"]);
    // A custom option has no default icon: the card shows the one its settings chose.
    const lounge = [...container.querySelectorAll(".pk-stat-card")].find(
      (card) => card.querySelector(".pk-stat-card__label")?.textContent === "Livestream Lounge",
    );
    const configuredIcon = mount(<AttendanceIcon type="livestream_lounge" icon="people" />).innerHTML;
    expect(configuredIcon).not.toBe("");
    expect(lounge?.querySelector(".pk-stat-card__icon")?.innerHTML).toBe(configuredIcon);
    expect(mount(<AttendanceIcon type="livestream_lounge" />).innerHTML).toBe("");
  });
});

describe("RegistrationTotals without attendance options", () => {
  it("says the options failed to load and loads them again on request", () => {
    const retry = vi.fn();
    const container = mount(
      <RegistrationTotals stats={stats} attendanceOptions={[]} onRetryAttendanceOptions={retry} />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The event's attendance options could not be loaded.",
    );
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Try again");
    void act(() => button?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows no warning while the options are loaded", () => {
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("RegistrationTotals breakdown", () => {
  it("states pending, waitlisted and cancelled the same way on every card", () => {
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} />);
    const notes = Object.fromEntries(
      [...container.querySelectorAll(".pk-stat-card")].map((card) => [
        card.querySelector(".pk-stat-card__label")?.textContent,
        card.querySelector(".pk-stat-card__note")?.textContent ?? null,
      ]),
    );
    expect(notes).toEqual({
      Registered: "1 pending · 2 waitlisted · 3 cancelled",
      "In-person": "1 pending · 2 waitlisted · 2 cancelled",
      Virtual: null,
      Bounced: null,
    });
  });

  it("keeps an attendance card whose registrations were all cancelled, at zero", () => {
    const container = mount(
      <RegistrationTotals
        stats={{
          ...stats,
          attendanceStatusByType: {
            virtual: { total: 0, accepted: 0, waitlisted: 0, expired: 0, pending: 0, cancelled: 4 },
          },
        }}
        attendanceOptions={options}
      />,
    );
    const virtual = [...container.querySelectorAll(".pk-stat-card")].find(
      (card) => card.querySelector(".pk-stat-card__label")?.textContent === "Virtual",
    );
    expect(virtual?.querySelector(".pk-stat-card__value")?.textContent).toBe("0");
    expect(virtual?.querySelector(".pk-stat-card__note")?.textContent).toBe("4 cancelled");
  });
});

describe("listFilters", () => {
  it("keeps the column filters and drops search, sort and paging", () => {
    expect(listFilters({ q: "ada", sort: "-created_at", limit: "50", offset: "0", status: "registered" })).toEqual({
      status: "registered",
    });
  });
});
