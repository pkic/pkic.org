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

function card(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>(".pk-stat-card")].find(
    (candidate) => candidate.querySelector(".pk-stat-card__label")?.textContent === label,
  );
  if (!found) throw new Error(`No card labeled "${label}"`);
  return found;
}

/** A figure under a card's value, found by what it shows: "2 waitlisted". */
function part(container: HTMLElement, label: string, text: string): HTMLButtonElement {
  const button = [...card(container, label).querySelectorAll<HTMLButtonElement>(".pk-stat-card__part")].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`No figure "${text}" on "${label}"`);
  return button;
}

describe("RegistrationTotals figures", () => {
  it("filters the list to an attendance card's waitlisted people on that type", () => {
    const list = filters({ country: "NL" });
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} filters={list} />);
    const waitlisted = part(container, "In-person", "2 waitlisted");
    expect(waitlisted.getAttribute("aria-pressed")).toBe("false");
    expect(waitlisted.getAttribute("aria-label")).toBe("Show only the 2 waitlisted In-person registrations");
    void act(() => waitlisted.click());
    expect(list.apply).toHaveBeenCalledWith({
      country: "",
      attendance_type: "in_person",
      status: "registered,pending_email_confirmation",
      waitlisted: "true",
    });
  });

  it("filters the registered card's figures by status alone", () => {
    const list = filters({});
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} filters={list} />);
    void act(() => part(container, "Registered", "1 pending").click());
    expect(list.apply).toHaveBeenLastCalledWith({ status: "pending_email_confirmation" });
    void act(() => part(container, "Registered", "3 cancelled").click());
    expect(list.apply).toHaveBeenLastCalledWith({ status: "cancelled" });
  });

  it("shows the applied figure as pressed, not its card, and clears the list on a second press", () => {
    const list = filters({ attendance_type: "in_person", status: "cancelled" });
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} filters={list} />);
    const cancelled = part(container, "In-person", "2 cancelled");
    expect(cancelled.getAttribute("aria-pressed")).toBe("true");
    expect(toggle(container, "Show In-person only").getAttribute("aria-pressed")).toBe("false");
    void act(() => cancelled.click());
    expect(list.apply).toHaveBeenCalledWith({ attendance_type: "", status: "" });
  });

  it("states each figure as a row in the card's tooltip", () => {
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} />);
    const trigger = card(container, "In-person").querySelector<HTMLButtonElement>(".pk-tooltip__trigger");
    void act(() => trigger?.click());
    const rows = [...document.querySelectorAll(".pk-totals-tip__row")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map(([, count]) => count)).toEqual(["1", "2", "2"]);
  });
});

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
    // Registered and bounced filter, with the registered card's figures; the attendance cards do not.
    expect(container.querySelectorAll(".pk-stat-card__press")).toHaveLength(2);
    const inPerson = card(container, "In-person");
    expect(inPerson.querySelectorAll("button")).toHaveLength(1);
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
  it("offers to load the options again from a card in the totals", () => {
    const retry = vi.fn();
    const container = mount(
      <RegistrationTotals stats={stats} attendanceOptions={[]} onRetryAttendanceOptions={retry} />,
    );
    const group = container.querySelector('[role="group"]');
    const actions = [...(group?.querySelectorAll("button.pk-stat-card__press") ?? [])];
    expect(actions).toHaveLength(1);
    // An action, not a filter toggle.
    expect(actions[0].hasAttribute("aria-pressed")).toBe(false);
    void act(() => (actions[0] as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("offers no retry while the options are loaded", () => {
    const container = mount(<RegistrationTotals stats={stats} attendanceOptions={options} />);
    expect(container.querySelector("button.pk-stat-card__press:not([aria-pressed])")).toBeNull();
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
