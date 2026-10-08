// @vitest-environment jsdom
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { Calendar } from "../../assets/ts/components/Calendar";
import { calendarRange, moveCalendar } from "../../assets/ts/components/calendar-range";
afterEach(() => {
  render(null, document.body);
  document.body.innerHTML = "";
});
describe("calendar projection", () => {
  it("uses local midnight boundaries across the DST transition", () => {
    const range = calendarRange("2026-03-29", "week", "Europe/Amsterdam");
    expect(range.dates).toHaveLength(7);
    expect(range.from).toBe("2026-03-22T23:00:00.000Z");
    expect(range.to).toBe("2026-03-29T22:00:00.000Z");
  });
  it("renders a complete month grid and navigates month ends safely", () => {
    expect(calendarRange("2026-02-28", "month", "Pacific/Auckland").dates).toHaveLength(35);
    expect(moveCalendar("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(moveCalendar("2026-12-31", "week", 1)).toBe("2027-01-07");
  });
  it("marks only confirmed empty days for compact mobile month presentation", () => {
    const items = [{ id: "one", startsAt: "2026-10-04T10:00:00.000Z", endsAt: "2026-10-04T11:00:00.000Z" }];
    render(
      <Calendar
        date="2026-10-04"
        view="month"
        timeZone="Europe/Amsterdam"
        items={items}
        complete
        renderItem={() => "Meeting"}
      />,
      document.body,
    );
    expect(document.querySelectorAll(".pk-calendar__day:not(.pk-calendar__day--empty)")).toHaveLength(1);
    expect(document.querySelectorAll(".pk-calendar__day").length).toBeGreaterThan(28);
    render(
      <Calendar
        date="2026-10-04"
        view="month"
        timeZone="Europe/Amsterdam"
        items={[]}
        complete={false}
        renderItem={() => null}
      />,
      document.body,
    );
    expect(document.querySelectorAll(".pk-calendar__day--empty")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("No meetings in this date range.");
    render(
      <Calendar
        date="2026-10-04"
        view="month"
        timeZone="Europe/Amsterdam"
        items={[]}
        complete
        renderItem={() => null}
      />,
      document.body,
    );
    expect(document.querySelector(".pk-calendar__mobile-empty")?.textContent).toBe("No meetings in this date range.");
  });

  it("renders meetings across local dates without claiming partial empty dates are empty", () => {
    const items = [{ id: "night", startsAt: "2026-10-04T21:30:00.000Z", endsAt: "2026-10-04T23:30:00.000Z" }];
    render(
      <Calendar
        date="2026-10-04"
        view="month"
        timeZone="Europe/Amsterdam"
        items={items}
        complete={false}
        renderItem={() => <a href="#meeting">Night meeting</a>}
      />,
      document.body,
    );
    expect(document.querySelectorAll('section[aria-label="2026-10-04"] a')).toHaveLength(1);
    expect(document.querySelectorAll('section[aria-label="2026-10-05"] a')).toHaveLength(1);
    expect(document.body.textContent).not.toContain("No meetings");
    render(
      <Calendar
        date="2026-10-04"
        view="week"
        timeZone="Europe/Amsterdam"
        items={[]}
        complete
        renderItem={() => null}
      />,
      document.body,
    );
    expect(document.querySelectorAll(".pk-calendar__day")).toHaveLength(7);
    expect(document.body.textContent).toContain("No meetings");
  });
});
