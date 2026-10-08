/**
 * A date on a server-rendered page is read twice: once by the Worker, which
 * cannot know the reader's locale or zone, and again by `local-time.js` in the
 * reader's browser. Both readings come from `formatLocalTime`, so the element
 * the server writes has to carry everything the browser needs to repeat it.
 */
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatClockInZone, formatLocalTime } from "../../assets/shared/format-date";
import { initLocalTime } from "../../assets/js/modules/local-time.js";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { agendaLocalClock } from "../../assets/shared/agenda-time-display";
import { EventTime, LocalTime } from "../../assets/ts/site/SiteDate";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

function browserZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}

function publishedAgenda(startsAt = "2026-12-01T23:30:00.000Z", editor = false) {
  document.body.innerHTML = renderToString(
    <ContentAgenda
      timeZone="Europe/Amsterdam"
      editor={editor ? { session: () => ({ controls: null }), dropTarget: () => null } : undefined}
      speakers={[]}
      days={[
        {
          date: "2026-12-02",
          locations: [{ id: "room", label: "Room" }],
          slots: [{ startsAt, time: formatClockInZone(startsAt, "Europe/Amsterdam"), sessions: [] }],
        },
      ]}
    />,
  );
  return document.querySelector<HTMLElement>(".pk-content-agenda")!;
}

describe("progressive public agenda clocks", () => {
  it("keeps complete venue-based HTML and offers a scoped browser-primary choice without a request", () => {
    browserZone("America/Los_Angeles");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const root = publishedAgenda();
    const eventClock = root.querySelector<HTMLElement>('[data-agenda-clock="venue"]')!;
    const localClock = root.querySelector<HTMLElement>('[data-agenda-clock="browser"]')!;
    expect(root.dataset.agendaTimeDisplay).toBe("venue");
    expect(eventClock.textContent).toContain("00:30");
    expect(localClock.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-agenda-time-choice]")!.hidden).toBe(true);
    expect(root.querySelector("[data-agenda-panel]")?.getAttribute("data-agenda-panel")).toBe("2026-12-02");
    const select = root.querySelector<HTMLSelectElement>("[data-agenda-time-select]")!;
    const listener = vi.spyOn(select, "addEventListener");
    const cleanup = initLocalTime(root);
    initLocalTime(root);
    expect(listener.mock.calls.filter(([event]) => event === "change")).toHaveLength(1);
    expect(root.querySelector<HTMLElement>("[data-agenda-time-choice]")!.hidden).toBe(false);
    expect(localClock.hidden).toBe(false);
    const local = agendaLocalClock("2026-12-01T23:30:00.000Z", "Europe/Amsterdam", "America/Los_Angeles");
    expect(localClock.querySelector("time")!.textContent).toBe(local.time);
    expect(localClock.querySelector("[data-agenda-local-date]")!.textContent).toBe(local.date);
    expect(localClock.querySelector<HTMLElement>("[data-agenda-local-date]")!.hidden).toBe(false);
    select.value = "browser";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.dataset.agendaTimeDisplay).toBe("browser");
    expect(eventClock.hidden).toBe(false);
    expect(eventClock.querySelector("time")!.getAttribute("datetime")).toBe("2026-12-01T23:30:00.000Z");
    expect(root.querySelector('.pk-content-agenda__time-heading small[title="Europe/Amsterdam"]')?.textContent).toBe(
      "Event · Amsterdam",
    );
    expect(eventClock.textContent).not.toContain("Amsterdam");
    expect(root.querySelector("[data-agenda-panel]")?.getAttribute("data-agenda-panel")).toBe("2026-12-02");
    select.value = "venue";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.dataset.agendaTimeDisplay).toBe("venue");
    expect(localClock.hidden).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    cleanup();
    select.value = "browser";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.dataset.agendaTimeDisplay).toBe("venue");
  });

  it("suppresses duplicate clocks and choice when the device uses the venue zone", () => {
    browserZone("Europe/Amsterdam");
    const root = publishedAgenda();
    initLocalTime(root);
    expect(root.querySelector<HTMLElement>("[data-agenda-time-choice]")!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-agenda-clock="browser"]')!.hidden).toBe(true);
    expect(root.dataset.agendaTimeDisplay).toBe("venue");
  });

  it("shows the next browser date without shifting the venue's agenda day", () => {
    browserZone("Asia/Tokyo");
    const root = publishedAgenda("2026-12-02T18:30:00.000Z");
    initLocalTime(root);
    const local = root.querySelector<HTMLElement>("[data-agenda-local-date]")!;
    expect(local.hidden).toBe(false);
    expect(local.textContent).toBe(agendaLocalClock("2026-12-02T18:30:00.000Z", "Europe/Amsterdam", "Asia/Tokyo").date);
    expect(root.querySelector("[data-agenda-panel]")?.getAttribute("data-agenda-panel")).toBe("2026-12-02");
  });
});

it("updates editor clocks without a public picker after the agenda mounts again", () => {
  browserZone("Asia/Tokyo");
  let root = publishedAgenda("2026-12-02T18:30:00.000Z", true);
  initLocalTime(root);
  expect(root.querySelector("[data-agenda-time-select]")).toBeNull();
  expect(root.dataset.agendaDistinctZones).toBe("true");
  expect(root.querySelector<HTMLElement>('[data-agenda-clock="browser"]')!.hidden).toBe(false);
  expect(root.querySelector("[data-agenda-local-date]")!.textContent).toBe(
    agendaLocalClock("2026-12-02T18:30:00.000Z", "Europe/Amsterdam", "Asia/Tokyo").date,
  );
  root = publishedAgenda("2026-03-20T18:30:00.000Z", true);
  initLocalTime(root);
  expect(root.querySelector('[data-agenda-clock="browser"] time')!.textContent).toBe(
    formatClockInZone("2026-03-20T18:30:00.000Z", "Asia/Tokyo"),
  );
  vi.restoreAllMocks();
  browserZone("Europe/Amsterdam");
  initLocalTime(root);
  expect(root.dataset.agendaDistinctZones).toBe("false");
  expect(root.querySelector<HTMLElement>('[data-agenda-clock="browser"]')!.hidden).toBe(true);
});
