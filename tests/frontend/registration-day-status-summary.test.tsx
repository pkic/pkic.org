// @vitest-environment jsdom
/**
 * The day-by-day state of a partly waitlisted registration.
 *
 * The version this replaces said "confirmed" and "pending" with three badge
 * fills — green, amber, blue — and nothing else, so the difference between a
 * confirmed day and a pending one was carried entirely by hue.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasPendingRegistrationDayWaitlist,
  isPendingRegistrationDayWaitlistStatus,
  RegistrationDayStatusSummary,
  type RegistrationDayAttendanceSummaryItem,
  type RegistrationDayWaitlistSummaryItem,
} from "../../assets/ts/components/RegistrationDayStatusSummary";

let container: HTMLDivElement | null = null;

function mount(
  dayAttendance: RegistrationDayAttendanceSummaryItem[],
  dayWaitlist: RegistrationDayWaitlistSummaryItem[] = [],
): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() =>
    render(<RegistrationDayStatusSummary dayAttendance={dayAttendance} dayWaitlist={dayWaitlist} />, container!),
  );
  return container;
}

afterEach(() => {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

describe("registration day waitlist predicates", () => {
  it("counts waiting and offered as pending, and nothing else", () => {
    expect(isPendingRegistrationDayWaitlistStatus("waiting")).toBe(true);
    expect(isPendingRegistrationDayWaitlistStatus("offered")).toBe(true);
    expect(isPendingRegistrationDayWaitlistStatus("admitted")).toBe(false);
    expect(hasPendingRegistrationDayWaitlist([{ dayDate: "2026-09-01", status: "admitted" }])).toBe(false);
    expect(hasPendingRegistrationDayWaitlist([{ dayDate: "2026-09-01", status: "waiting" }])).toBe(true);
  });
});

describe("RegistrationDayStatusSummary", () => {
  it("renders nothing at all when there are no days to report", () => {
    const root = mount([]);
    expect(root.innerHTML).toBe("");
  });

  it("announces itself as a region with a title rather than a coloured box", () => {
    const root = mount([{ dayDate: "2026-09-01", attendanceType: "in_person", label: "Day one" }]);

    const alert = root.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(root.querySelector(".pk-alert__title")?.textContent).toBe("What is confirmed right now");
  });

  it("pairs each day with its state as a term and a value", () => {
    const root = mount(
      [
        { dayDate: "2026-09-01", attendanceType: "in_person", label: "Day one" },
        { dayDate: "2026-09-02", attendanceType: "in_person", label: "Day two" },
        { dayDate: "2026-09-03", attendanceType: "virtual", label: null },
      ],
      [
        { dayDate: "2026-09-02", status: "waiting" },
        { dayDate: "2026-09-04", status: "offered" },
      ],
    );

    const list = root.querySelector("dl.pk-datalist");
    expect(list).not.toBeNull();
    const terms = [...root.querySelectorAll("dt")].map((term) => term.textContent);
    // A day with no label falls back to its date rather than rendering blank.
    expect(terms).toEqual(["Day one", "Day two", "2026-09-03"]);
  });

  it("says what each day's state is, so the badge tone is never the only signal", () => {
    const root = mount(
      [
        { dayDate: "2026-09-01", attendanceType: "in_person", label: "Day one" },
        { dayDate: "2026-09-02", attendanceType: "in_person", label: "Day two" },
        { dayDate: "2026-09-03", attendanceType: "in_person", label: "Day three" },
        { dayDate: "2026-09-04", attendanceType: "on_demand", label: "Day four" },
      ],
      [
        { dayDate: "2026-09-02", status: "waiting" },
        { dayDate: "2026-09-03", status: "offered" },
      ],
    );

    const values = [...root.querySelectorAll("dd .pk-badge")].map((badge) => ({
      text: badge.textContent,
      tone: [...badge.classList].find((name) => name.startsWith("pk-badge--") && name !== "pk-badge--dot"),
    }));
    expect(values).toEqual([
      { text: "In-person confirmed", tone: "pk-badge--ok" },
      { text: "In-person still pending", tone: "pk-badge--warn" },
      { text: "Spot available — review in manage page", tone: "pk-badge--info" },
      { text: "On-demand confirmed", tone: "pk-badge--ok" },
    ]);
  });

  it("writes no Bootstrap class names", () => {
    const root = mount([{ dayDate: "2026-09-01", attendanceType: "virtual", label: "Day one" }]);

    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      for (const name of element.classList) expect(name.startsWith("pk-")).toBe(true);
    }
  });
});
