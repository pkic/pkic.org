// @vitest-environment jsdom
/**
 * What a chart owes a reader who cannot see it.
 *
 * Every chart here used to be `aria-hidden="true"` with its numbers locked
 * inside that hidden subtree, so a screen reader received nothing at all from
 * a page whose entire content is data. These assert the replacement: the
 * picture stays hidden, and the same numbers are reachable as a named table.
 *
 * They also assert what the picture is drawn WITH. A hard-coded grey grid line
 * is invisible on a dark ground, and that is not something a snapshot of the
 * light theme would ever catch.
 */

import { describe, expect, it } from "vitest";

import {
  fmtMoney,
  statusBars,
  svgBarChart,
  svgLineChart,
  svgStackedBarChart,
  svgStatusSegmentBar,
  recentActivityChart,
} from "../../assets/ts/ui/chart";

function parse(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

/** Every colour a chart paints with, from fill/stroke attributes. */
function paints(markup: string): string[] {
  return [...markup.matchAll(/(?:fill|stroke)="([^"]*)"/g)]
    .map((match) => match[1])
    .filter((value) => value !== "none" && value !== "transparent" && value !== "inherit");
}

const DAYS = ["01/09", "02/09", "03/09"];
const ISO = ["2026-09-01", "2026-09-02", "2026-09-03"];

describe("chart accessibility", () => {
  it("hides the picture and offers the same numbers as a named table", () => {
    const host = parse(
      svgBarChart(DAYS, [4, 0, 7], { caption: "Registrations per day", valueHeader: "Registrations" }),
    );

    expect(host.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

    const table = host.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.className).toContain("pk-sr-only");
    expect(table?.querySelector("caption")?.textContent).toBe("Registrations per day");
    expect([...table!.querySelectorAll("th[scope='col']")].map((th) => th.textContent)).toEqual([
      "Period",
      "Registrations",
    ]);
    expect([...table!.querySelectorAll("tbody tr")].map((row) => row.textContent)).toEqual([
      "01/094",
      "02/090",
      "03/097",
    ]);
  });

  it("names the figure itself, so the region is announced before its contents", () => {
    const host = parse(svgBarChart(DAYS, [1, 2, 3], { caption: "Registrations per day" }));
    expect(host.querySelector("figure")?.getAttribute("aria-label")).toBe("Registrations per day");
  });

  it("keeps decorative SVG out of the tab order", () => {
    const host = parse(
      svgStackedBarChart(DAYS, [{ label: "Accepted", values: [1, 2, 3], color: "var(--pk-ok)" }], {
        caption: "Registrations by day",
      }),
    );
    for (const svg of host.querySelectorAll("svg")) {
      expect(svg.getAttribute("focusable")).toBe("false");
    }
  });

  it("carries every series and the total in the stacked chart's table", () => {
    const host = parse(
      svgStackedBarChart(
        DAYS,
        [
          { label: "Accepted", values: [2, 1, 0], color: "var(--pk-ok)" },
          { label: "Pending", values: [1, 1, 3], color: "var(--pk-warn)" },
        ],
        { caption: "Registrations by day", isoLabels: ISO },
      ),
    );
    const table = host.querySelector("table")!;
    expect([...table.querySelectorAll("th[scope='col']")].map((th) => th.textContent)).toEqual([
      "Date",
      "Accepted",
      "Pending",
      "Total",
    ]);
    // The ISO date, not the abbreviated axis label: a table has room to be exact.
    expect([...table.querySelectorAll("tbody tr")].map((row) => row.textContent)).toEqual([
      "2026-09-01213",
      "2026-09-02112",
      "2026-09-03033",
    ]);
  });

  it("formats the table's values the same way the chart labels them", () => {
    const host = parse(
      svgStackedBarChart(["Sep"], [{ label: "Net (USD)", values: [12_50], color: "var(--pk-ok)" }], {
        caption: "Donation amounts",
        valueFormatter: (value) => fmtMoney(value, "usd"),
      }),
    );
    expect(host.querySelector("tbody")?.textContent).toContain("$12.50");
  });

  it("labels each line series in the table and the legend", () => {
    const host = parse(recentActivityChart([{ date: "2026-09-01", registrations: 3, invites: 1 }]));
    const table = host.querySelector("table")!;
    expect([...table.querySelectorAll("th[scope='col']")].map((th) => th.textContent)).toEqual([
      "Date",
      "Registrations",
      "Invites",
    ]);
    expect(host.querySelector(".pk-chart__legend")?.textContent).toBe("RegistrationsInvites");
  });

  it("gives the status bar its counts and shares", () => {
    const host = parse(
      svgStatusSegmentBar({ registered: 7, cancelled: 3 }, 10, { caption: "Registrations by status" }),
    );
    expect([...host.querySelectorAll("tbody tr")].map((row) => row.textContent)).toEqual([
      "Confirmed770%",
      "Cancelled330%",
    ]);
  });

  it("says so plainly when there is nothing to plot, rather than drawing an empty frame", () => {
    for (const markup of [
      svgBarChart([], [], { caption: "Registrations" }),
      svgStackedBarChart([], [], { caption: "Registrations" }),
      svgLineChart([{ label: "A", values: [0], stroke: "var(--pk-ok)", area: "none" }], ["x"], { caption: "A" }),
      svgStatusSegmentBar({}, 0, { caption: "Status" }),
      statusBars({}, 0),
    ]) {
      expect(markup).toBe('<p class="pk-muted">No data</p>');
    }
  });

  it("escapes labels rather than letting them close a tag", () => {
    const host = parse(svgBarChart(["</text><script>x</script>"], [1], { caption: "Registrations" }));
    expect(host.querySelector("script")).toBeNull();
  });
});

describe("chart theming", () => {
  it("paints only with tokens, so the grid and labels survive a dark ground", () => {
    const markup = svgStackedBarChart(DAYS, [{ label: "Accepted", values: [2, 1, 0], color: "var(--pk-ok)" }], {
      caption: "Registrations by day",
      isoLabels: ISO,
    });
    const literals = paints(markup).filter((value) => !value.startsWith("var(--pk-"));
    expect(literals).toEqual([]);
  });

  it("uses tokens for the line chart's strokes and fills too", () => {
    const markup = recentActivityChart([
      { date: "2026-09-01", registrations: 3, invites: 1 },
      { date: "2026-09-02", registrations: 4, invites: 2 },
    ]);
    for (const value of paints(markup)) {
      expect(value).toMatch(/var\(--pk-|color-mix\(in oklab, var\(--pk-/);
    }
  });

  it("carries no Bootstrap class into the markup it emits", () => {
    const everything = [
      svgBarChart(DAYS, [1, 2, 3], { caption: "A" }),
      svgStackedBarChart(DAYS, [{ label: "S", values: [1, 2, 3], color: "var(--pk-ok)" }], { caption: "B" }),
      svgStatusSegmentBar({ registered: 1 }, 1, { caption: "C" }),
      statusBars({ registered: 1 }, 1),
      recentActivityChart([{ date: "2026-09-01", registrations: 1, invites: 1 }]),
    ].join("");
    for (const match of everything.matchAll(/class="([^"]*)"/g)) {
      for (const token of match[1].split(/\s+/).filter(Boolean)) {
        expect(token).toMatch(/^pk-/);
      }
    }
  });
});
