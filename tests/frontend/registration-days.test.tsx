import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationDays } from "../../assets/ts/components/events/RegistrationDays";
import { readResponse } from "./helpers/participant-registration-fixtures";

let container: HTMLDivElement | null = null;
afterEach(() => {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

it.each(["retired", "waiting without attendance"])(
  "shows saved %s days without a misleading matrix selection",
  (state) => {
    const data = readResponse(
      state === "retired"
        ? {
            dayAttendance: [
              { dayDate: "2026-12-01", attendanceType: "moon_base", optionLabel: "Moon base", label: null },
            ],
          }
        : {
            dayAttendance: [],
            dayWaitlist: [{ dayDate: "2026-12-01", status: "waiting", priorityLane: "general", offerExpiresAt: null }],
          },
    );
    container = document.createElement("div");
    document.body.append(container);
    void act(() =>
      render(<RegistrationDays data={data} busy={false} editable onSave={vi.fn()} onClaim={vi.fn()} />, container!),
    );
    expect(container.querySelector('[aria-label="Attendance choices"]')).toBeNull();
    const summary = container.querySelector('[aria-label="Your registration, day by day"]');
    expect(summary?.textContent).toContain(state === "retired" ? "Moon base" : "Waitlisted");
    expect(summary?.textContent).not.toContain("Not attending");
  },
);

it("keeps expired-offer recovery visible beside the saved attendance", () => {
  const data = readResponse({
    dayWaitlist: [{ dayDate: "2026-12-01", status: "expired", priorityLane: "general", offerExpiresAt: null }],
  });
  container = document.createElement("div");
  document.body.append(container);
  void act(() =>
    render(<RegistrationDays data={data} busy={false} editable onSave={vi.fn()} onClaim={vi.fn()} />, container!),
  );
  expect(container.querySelector('[aria-label="Attendance choices"]')).toBeNull();
  expect(container.textContent).toContain("Offer expired");
  expect(container.textContent).toContain("Update and save your attendance to request a place again");
});
