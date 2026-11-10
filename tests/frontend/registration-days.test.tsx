import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationDays } from "../../assets/ts/components/events/RegistrationDays";
import { readResponse } from "./helpers/participant-registration-fixtures";
import { buttonNamed } from "./helpers/labeled-control";

const host = document.createElement("div");
afterEach(() => {
  render(null, host);
  host.remove();
});

it("opens the picker with the email link's day focused without changing any choices", async () => {
  const data = readResponse();
  const day = data.eventDays[0]!;
  data.eventDays.push({ ...day, dayDate: "2026-12-02", label: "Day 2" });
  data.dayAttendance.push({ dayDate: "2026-12-02", attendanceType: "on_demand", label: "Day 2" });
  const save = vi.fn();
  document.body.append(host);
  await act(() =>
    render(
      <RegistrationDays data={data} editable busy={false} onSave={save} onClaim={vi.fn()} focusDay="2026-12-02" />,
      host,
    ),
  );
  expect(document.activeElement?.getAttribute("name")).toBe("dayAttendance.2026-12-02");
  expect((document.activeElement as HTMLInputElement).value).toBe("on_demand");
  expect(save).not.toHaveBeenCalled();
});

it("changes a waiting day without asking to release a seat it does not hold", async () => {
  const data = readResponse({
    dayWaitlist: [{ dayDate: "2026-12-01", status: "waiting", priorityLane: "general", offerExpiresAt: null }],
  });
  const save = vi.fn();
  document.body.append(host);
  await act(() => render(<RegistrationDays data={data} editable busy={false} onSave={save} onClaim={vi.fn()} />, host));
  await act(() => buttonNamed(host, "Change my days").click());
  await act(() => host.querySelector<HTMLInputElement>('input[value="on_demand"]')!.click());
  await act(() => buttonNamed(host, "Save my days").click());
  expect(save).toHaveBeenCalledOnce();
  expect(document.querySelector("dialog")).toBeNull();
});
