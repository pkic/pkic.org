// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { eventDayReadModelSchema } from "../../assets/shared/schemas/event-read-models";
import { DayAttendancePicker } from "../../assets/ts/components/DayAttendancePicker";
import { updateRegistrationReview } from "../../assets/ts/components/events/registration-review";

let host: HTMLDivElement;
afterEach(() => {
  render(null, host);
  host.remove();
});

it("reviews every configured day, including unselected days, and updates when a choice changes", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const days = [1, 2, 3].map((number) =>
    eventDayReadModelSchema.parse({
      dayDate: `2027-09-0${number}`,
      label: `Day ${number}`,
      inPersonCapacity: null,
      sortOrder: number,
      attendanceOptions: [{ value: "virtual", label: "Virtual" }],
    }),
  );
  await act(() =>
    render(
      <form>
        <DayAttendancePicker days={days} />
        <div data-registration-review />
      </form>,
      host,
    ),
  );
  const form = host.querySelector("form")!;
  const refresh = () => updateRegistrationReview(host, form, []);
  await act(refresh);
  const review = host.querySelector("[data-registration-review]")!;
  expect(review.textContent?.match(/Not attending/g)).toHaveLength(3);
  await act(() => form.querySelector<HTMLInputElement>('input[name="dayAttendance.2027-09-01"]')!.click());
  await act(refresh);
  for (const day of days) expect(review.textContent).toContain(day.label);
  expect(review.textContent?.match(/Not attending/g)).toHaveLength(2);
  expect(review.textContent).toContain("Virtual");
  await act(() => form.querySelector<HTMLInputElement>('input[name="dayAttendance.2027-09-02"]')!.click());
  await act(refresh);
  expect(review.textContent?.match(/Not attending/g)).toHaveLength(1);
});
