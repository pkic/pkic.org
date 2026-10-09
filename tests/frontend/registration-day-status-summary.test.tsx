// @vitest-environment jsdom
/**
 * The day-by-day state of a partly waitlisted registration.
 *
 * Days are grouped by what they amount to, so identical days read once, and a
 * waiting-list or offered day is its own row that says its state in words —
 * the tint repeats the words, it never carries them alone.
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

  it("states identical confirmed days once, as all the days", () => {
    const root = mount([
      { dayDate: "2026-09-01", attendanceType: "in_person", label: "Day one" },
      { dayDate: "2026-09-02", attendanceType: "in_person", label: "Day two" },
      { dayDate: "2026-09-03", attendanceType: "in_person", label: null },
    ]);
    const rows = [...root.querySelectorAll<HTMLElement>(".pk-day-status__row")];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("In-person");
    expect(rows[0]!.textContent).toContain("All 3 days");
  });

  it("splits only where days differ, with the offered seat first and the waiting list in words", () => {
    const root = mount(
      [
        { dayDate: "2026-09-01", attendanceType: "in_person", label: null },
        { dayDate: "2026-09-02", attendanceType: "in_person", label: null },
        { dayDate: "2026-09-03", attendanceType: "in_person", label: null },
        { dayDate: "2026-09-04", attendanceType: "on_demand", label: null },
      ],
      [
        { dayDate: "2026-09-02", status: "waiting" },
        { dayDate: "2026-09-03", status: "offered" },
      ],
    );
    const rows = [...root.querySelectorAll<HTMLElement>(".pk-day-status__row")];
    expect(rows.map((row) => row.dataset.kind)).toEqual(["offered", "waiting", "confirmed", "confirmed"]);
    expect(rows[0]!.textContent).toContain("An in-person seat is yours to claim");
    expect(rows[1]!.textContent).toContain("On the waiting list for an in-person seat");
    expect(rows[1]!.textContent).toContain("You stay registered");
    expect(rows.map((row) => row.querySelector(".pk-day-status__title")?.textContent).slice(2)).toEqual([
      "In-person",
      "On-demand",
    ]);
    // Without a claim handler the screen only states the offer.
    expect(root.querySelector("button")).toBeNull();
  });

  it("offers the claim where the screen can act on it", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const claimed: string[][] = [];
    await act(() =>
      render(
        <RegistrationDayStatusSummary
          dayAttendance={[{ dayDate: "2026-09-01", attendanceType: "in_person", label: null }]}
          dayWaitlist={[{ dayDate: "2026-09-01", status: "offered" }]}
          onClaim={(days) => claimed.push(days)}
        />,
        container!,
      ),
    );
    await act(async () => container!.querySelector("button")!.click());
    expect(claimed).toEqual([["2026-09-01"]]);
  });

  it("writes no Bootstrap class names", () => {
    const root = mount([{ dayDate: "2026-09-01", attendanceType: "virtual", label: "Day one" }]);

    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      for (const name of element.classList) expect(name.startsWith("pk-")).toBe(true);
    }
  });
});
