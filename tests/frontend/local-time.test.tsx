/**
 * A date on a server-rendered page is read twice: once by the Worker, which
 * cannot know the reader's locale or zone, and again by `local-time.js` in the
 * reader's browser. Both readings come from `formatLocalTime`, so the element
 * the server writes has to carry everything the browser needs to repeat it.
 */
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { formatLocalTime } from "../../assets/shared/format-date";
import { initLocalTime } from "../../assets/js/modules/local-time.js";
import { EventTime, LocalTime } from "../../assets/ts/site/SiteDate";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(markup: string): HTMLTimeElement {
  document.body.innerHTML = markup;
  return document.querySelector("time")!;
}

describe("local time", () => {
  it("omits a duplicate viewer clock when the browser uses the event zone", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.body.innerHTML = `<div data-local-time-container data-event-time-zone="${zone}" hidden>${renderToString(<LocalTime value="2026-12-01T08:00:00.000Z" format="time" />)}</div>`;
    initLocalTime();
    expect(document.querySelector<HTMLElement>("[data-local-time-container]")!.hidden).toBe(true);
    document.querySelector<HTMLElement>("[data-local-time-container]")!.dataset.eventTimeZone =
      zone === "Asia/Tokyo" ? "Europe/Amsterdam" : "Asia/Tokyo";
    initLocalTime();
    expect(document.querySelector<HTMLElement>("[data-local-time-container]")!.hidden).toBe(false);
  });

  it("writes the policy's own rendering as fallback text, with the value and format to repeat it", () => {
    const element = mount(renderToString(<LocalTime value="2026-09-04" />));

    expect(element.getAttribute("datetime")).toBe("2026-09-04");
    expect(element.dataset.localTime).toBe("2026-09-04");
    expect(element.dataset.localTimeFormat).toBe("date");
    expect(element.textContent).toBe(formatLocalTime("2026-09-04", "date"));
  });

  it("rewrites every format through the same policy in the browser", () => {
    document.body.innerHTML = renderToString(
      <>
        <LocalTime value="2026-12-01" format="weekday" />
        <LocalTime value="2026-12-01T08:00:00.000Z" format="date-time" />
        <LocalTime value="2026-12-01T08:00:00.000Z" format="time" />
        <EventTime value="2026-12-01T08:00:00.000Z" duration={3} />
      </>,
    );
    for (const element of document.querySelectorAll("time")) element.textContent = "stale";

    initLocalTime();

    const [weekday, instant, time, span] = [...document.querySelectorAll("time")].map((element) => element.textContent);
    expect(weekday).toBe(formatLocalTime("2026-12-01", "weekday"));
    expect(instant).toBe(formatLocalTime("2026-12-01T08:00:00.000Z", "date-time"));
    expect(time).toBe(formatLocalTime("2026-12-01T08:00:00.000Z", "time"));
    expect(span).toBe(formatLocalTime("2026-12-01T08:00:00.000Z", "date", "2026-12-03T08:00:00.000Z"));
  });

  it("reveals a personal clock only after computing the viewer's time", () => {
    document.body.innerHTML =
      "<div data-local-time-container hidden>" +
      renderToString(<LocalTime value="2026-12-01T08:00:00.000Z" format="time" />) +
      "</div>";
    const container = document.querySelector("div")!;
    expect(container.hidden).toBe(true);
    initLocalTime();
    expect(container.hidden).toBe(false);
    expect(container.textContent).toBe(formatLocalTime("2026-12-01T08:00:00.000Z", "time"));
  });

  it("names a single-day event's time with its zone and spans a longer one", () => {
    const single = mount(renderToString(<EventTime value="2026-12-01T08:00:00.000Z" />));
    expect(single.dataset.localTimeFormat).toBe("date-time");
    expect(single.dataset.localTimeUntil).toBeUndefined();

    const multi = mount(renderToString(<EventTime value="2026-12-01T08:00:00.000Z" duration={3} />));
    expect(multi.dataset.localTimeFormat).toBe("date");
    expect(multi.dataset.localTimeUntil).toBe("2026-12-03T08:00:00.000Z");
  });

  it("answers an em dash for a value it cannot read, and leaves an element without a known format alone", () => {
    expect(mount(renderToString(<LocalTime value="not a date" />)).textContent).toBe("—");

    const unknown = mount('<time data-local-time="2026-09-04" data-local-time-format="fortnight">as written</time>');
    initLocalTime();
    expect(unknown.textContent).toBe("as written");
  });
});
