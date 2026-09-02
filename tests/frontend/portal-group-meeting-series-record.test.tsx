// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEventSeries } from "../../assets/shared/schemas/event-series";
import { GroupMeetingSeriesRecord } from "../../assets/ts/member-flows/portal/sections/management/GroupMeetingSeriesRecord";
import { groupEventSeriesFixture } from "./helpers/meeting-series-fixture";
import { isCurrentTab, tabs } from "./helpers/tabs";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  navigate.mockReset();
});

function baseSeries(overrides: Partial<GroupEventSeries> = {}): GroupEventSeries {
  return groupEventSeriesFixture(GROUP_ID, overrides);
}

/**
 * A meeting series is a routed record page: it fetches itself by id through
 * the group context, heads the page with the record title, and offers its
 * facets as URL-addressed tabs.
 */
describe("the meeting series record page", () => {
  const EMPTY_OCCURRENCES = { occurrences: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } };

  /** The record fetches its series by id, then its open facet fetches its own data. */
  function stubSeriesFetch(
    series: GroupEventSeries,
    requests: URL[] = [],
    occurrences: () => Response = () => json(EMPTY_OCCURRENCES),
  ): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname.endsWith("/occurrences")) return occurrences();
        return json({ series });
      }),
    );
  }

  function backLink(root: ParentNode): HTMLButtonElement | undefined {
    return [...root.querySelectorAll("button")].find((button) => button.textContent?.includes("All meeting series"));
  }

  it("fetches the series through the group context and heads its page with the record title", async () => {
    const series = baseSeries();
    const requests: URL[] = [];
    stubSeriesFetch(series, requests);

    const container = mount(<GroupMeetingSeriesRecord groupId={GROUP_ID} seriesId={series.id} onLeave={() => {}} />);
    await settle();
    await settle();

    expect(requests.map((url) => url.pathname)).toContain(`/api/v1/groups/${GROUP_ID}/meetings/series/${series.id}`);
    // h3: the shell owns h1 and the workspace's PageHeader owns h2, so the
    // record inside a workspace tab is the next level down.
    expect(container.querySelector("h3.pk-record-title")?.textContent).toBe("Architecture call");
    expect(container.textContent).toContain("Online");
    expect(backLink(container)).toBeDefined();
  });

  it("names each series region after the series it belongs to, and links no tab to a missing id", async () => {
    const series = baseSeries();
    stubSeriesFetch(series);

    const container = mount(<GroupMeetingSeriesRecord groupId={GROUP_ID} seriesId={series.id} onLeave={() => {}} />);
    await settle();

    // The tabs navigate, so they are links marked `aria-current` — not the
    // ARIA tab pattern, and so the regions below are named sections rather
    // than tabpanels pointing at ids no link carries.
    expect(container.querySelector("[role='tabpanel']")).toBeNull();
    const region = container.querySelector("section[aria-label]");
    expect(region?.getAttribute("aria-label")).toBe("Architecture call occurrences");
    for (const element of container.querySelectorAll("[aria-labelledby]")) {
      const target = element.getAttribute("aria-labelledby")!;
      expect(container.querySelector(`[id="${target}"]`)).not.toBeNull();
    }
  });

  it("returns to the meeting series list from the record's back link", async () => {
    const series = baseSeries();
    stubSeriesFetch(series);
    const onLeave = vi.fn();

    const container = mount(<GroupMeetingSeriesRecord groupId={GROUP_ID} seriesId={series.id} onLeave={onLeave} />);
    await settle();
    await act(async () => backLink(container)!.click());

    expect(onLeave).toHaveBeenCalledOnce();
  });

  it("announces a series that cannot be fetched as an alert and keeps the way back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "EVENT_SERIES_NOT_FOUND", message: "Meeting series is not available through this group" },
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const container = mount(
      <GroupMeetingSeriesRecord groupId={GROUP_ID} seriesId={baseSeries().id} onLeave={() => {}} />,
    );
    await settle();

    expect(container.querySelector("[role='alert']")).not.toBeNull();
    expect(container.querySelector("h3.pk-record-title")).toBeNull();
    expect(backLink(container)).toBeDefined();
  });

  it("opens the tab given by an initial resourceTab", async () => {
    const series = baseSeries();
    stubSeriesFetch(series);

    const container = mount(
      <GroupMeetingSeriesRecord groupId={GROUP_ID} seriesId={series.id} initialTab="settings" onLeave={() => {}} />,
    );
    await settle();

    const settingsTab = tabs(container).find((item) => item.textContent === "Series settings");
    expect(isCurrentTab(settingsTab)).toBe(true);
    expect(container.textContent).toContain("Save series");
  });

  it("shows no tab row when only Occurrences is open to the reader, whatever the resourceTab asks for", async () => {
    const series = baseSeries({ capabilities: ["view"] });
    stubSeriesFetch(series);

    const container = mount(
      <GroupMeetingSeriesRecord groupId={GROUP_ID} seriesId={series.id} initialTab="settings" onLeave={() => {}} />,
    );
    await settle();

    // One facet is not a choice, so there is nothing to switch between; the
    // unavailable tab falls back to the occurrences rather than an empty page.
    expect(tabs(container)).toHaveLength(0);
    expect(container.querySelector("section[aria-label]")?.getAttribute("aria-label")).toBe(
      "Architecture call occurrences",
    );
    expect(container.textContent).not.toContain("Save series");
  });

  it("links the tabs to the series' canonical URLs, the default one to the record itself", async () => {
    const series = baseSeries();
    stubSeriesFetch(series);

    const container = mount(<GroupMeetingSeriesRecord groupId={GROUP_ID} seriesId={series.id} onLeave={() => {}} />);
    await settle();

    const occurrencesTab = tabs(container).find((item) => item.textContent === "Occurrences")!;
    expect(occurrencesTab.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/meetings/${series.id}`);
    const settingsTab = tabs(container).find((item) => item.textContent === "Series settings")!;
    expect(settingsTab.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/meetings/${series.id}/settings`);

    await act(async () => {
      settingsTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/meetings/${series.id}/settings`);
  });
});
