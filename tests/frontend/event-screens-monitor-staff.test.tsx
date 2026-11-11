// @vitest-environment jsdom
/**
 * Staff's side of the screen monitor: the view built from its messages, the
 * connection with its commands, the multi-view's issue badges, order and
 * attention filter, and the opt-in browser notification.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screenIssues, type ScreenIssue } from "../../assets/shared/event-screen-issues";
import {
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorServerMessageSchema,
  screenMonitorStaffMessageSchema,
  type ScreenLiveStatus,
  type ScreenMonitorServerMessage,
} from "../../assets/shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../assets/shared/schemas/event-screens";
import { EventScreens } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/EventScreens";
import {
  applyScreenMonitorMessage,
  EMPTY_SCREEN_MONITOR_VIEW,
  staffClockOffset,
  type ScreenMonitorView,
} from "../../assets/ts/member-flows/portal/sections/events/detail/screens/screen-monitor-view";
import { useScreenIssueNotifications } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/useScreenIssueNotifications";
import { useScreenMonitorController } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/useScreenMonitorController";
import { useScreenMonitorStaff } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/useScreenMonitorStaff";
import { fakeLiveSockets } from "./helpers/live-room-socket";

const SLUG = "pqc-conference-2026";
const NOW = Date.parse("2026-12-01T09:27:20.000Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

const status = (screenId: string, overrides: Partial<ScreenLiveStatus> = {}): ScreenLiveStatus => ({
  screenId,
  online: true,
  connectedAt: at(3600),
  disconnectedAt: null,
  reportedAt: at(5),
  stateSince: at(600),
  health: {
    pageVersion: "p",
    display: "output",
    output: "projector",
    mode: "live",
    player: null,
    clockOffsetMs: 0,
    metrics: null,
  },
  ...overrides,
});
const message = (value: unknown) => screenMonitorServerMessageSchema.parse(value);

let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.location.hash = "";
  localStorage.clear();
});

describe("the staff view of the monitor", () => {
  it("builds each screen's status, hour and screenshot from the monitor's messages", () => {
    let view: ScreenMonitorView = EMPTY_SCREEN_MONITOR_VIEW;
    const sample = {
      minute: "2026-12-01T09:27:00.000Z",
      internetLatencyMs: 20,
      internetLossPercent: 0,
      routerLatencyMs: 2,
      wifiSignalPercent: 70,
      rxBitsPerSecond: null,
      livestreamStalls: null,
    };
    view = applyScreenMonitorMessage(
      view,
      message({ type: "screens.snapshot", serverNow: NOW, control: true, screens: [status("K7M2QA")], quality: [] }),
    );
    view = applyScreenMonitorMessage(
      view,
      message({ type: "screens.screenshot", serverNow: NOW, screenId: "K7M2QA", capturedAt: at(2), jpeg: "/9j/4AAQ" }),
    );
    view = applyScreenMonitorMessage(
      view,
      message({ type: "screens.changed", serverNow: NOW, screen: status("K7M2QA"), sample }),
    );
    view = applyScreenMonitorMessage(
      view,
      message({
        type: "screens.changed",
        serverNow: NOW,
        screen: status("K7M2QA"),
        sample: { ...sample, internetLatencyMs: 40 },
      }),
    );
    expect(view.quality.get("K7M2QA")).toEqual([{ ...sample, internetLatencyMs: 40 }]);
    expect(view.screenshots.get("K7M2QA")).toEqual({ capturedAt: at(2), src: "data:image/jpeg;base64,/9j/4AAQ" });
    // A screen the monitor forgot loses its screenshot with the next snapshot.
    view = applyScreenMonitorMessage(
      view,
      message({ type: "screens.snapshot", serverNow: NOW, control: true, screens: [], quality: [] }),
    );
    expect(view.screenshots.size).toBe(0);
    expect(view.live.size).toBe(0);
  });

  it("connects to the event's monitor, sends a manager's command and stops after a refusal", async () => {
    const sockets = fakeLiveSockets();
    let latest: ReturnType<typeof useScreenMonitorStaff> | undefined;
    function Probe() {
      latest = useScreenMonitorStaff({ slug: SLUG, createSocket: sockets.factory });
      return null;
    }
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe />, host!));
    expect(sockets.latest().url).toMatch(/\/api\/v1\/events\/pqc-conference-2026\/screens\/live$/);
    expect(sockets.latest().protocols).toEqual([SCREEN_MONITOR_PROTOCOL]);
    const deliver = (value: ScreenMonitorServerMessage) =>
      act(() => {
        sockets.latest().dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
      });
    await act(() => sockets.latest().open());
    await deliver(
      message({ type: "screens.snapshot", serverNow: NOW, control: true, screens: [status("K7M2QA")], quality: [] }),
    );
    expect(latest!.control).toBe(true);
    expect(latest!.status).toBe("live");
    expect(latest!.view.live.get("K7M2QA")?.online).toBe(true);

    await act(() => latest!.command("screen.identify", { id: "K7M2QA", name: "Foyer" } as ScreenRecord));
    const sent = screenMonitorStaffMessageSchema.parse(JSON.parse(sockets.latest().sent.at(-1)!));
    expect(sent).toMatchObject({ type: "screen.identify", screenId: "K7M2QA" });

    await act(() => sockets.latest().refuse(4403, "SCREEN_STATUS_FORBIDDEN"));
    expect(latest!.status).toBe("refused");
    expect(sockets.sockets).toHaveLength(1);
  });
});

describe("the staff clock", () => {
  it("reads ages on the monitor's clock, so a browser 90 s ahead shows no false Not responding", async () => {
    const server = NOW;
    vi.useFakeTimers();
    vi.setSystemTime(server + 90_000);
    const sockets = fakeLiveSockets();
    let latest: ReturnType<typeof useScreenMonitorController> | undefined;
    function Probe() {
      latest = useScreenMonitorController({ slug: SLUG, createSocket: sockets.factory });
      return null;
    }
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe />, host!));
    await act(() => sockets.latest().open());
    const screenshot = { type: "screens.screenshot", screenId: "K7M2QA", capturedAt: at(5), jpeg: "/9j/4AAQ" };
    await act(() => {
      for (const value of [
        { type: "screens.snapshot", serverNow: server, control: false, screens: [status("K7M2QA")], quality: [] },
        { ...screenshot, serverNow: server },
      ])
        sockets.latest().dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message(value)) }));
    });
    // On this browser's own clock the last heartbeat looks 95 s old.
    const view = latest!.view!;
    expect(
      screenIssues({
        status: view.live.get("K7M2QA"),
        samples: [],
        screenshotAt: at(5),
        now: Date.now(),
      }).map((issue) => issue.label),
    ).toContain("Not responding");
    expect(latest!.now).toBeLessThanOrEqual(server + 1_000);
    expect(latest!.issuesOf("K7M2QA")).toEqual([]);
  });

  it("chooses the offset with the least delay among recent messages", () => {
    expect(staffClockOffset([])).toBe(0);
    expect(staffClockOffset([-90_400, -90_050, -90_900])).toBe(-90_050);
  });
});

describe("the multi-view", () => {
  const record = (id: string, name: string): ScreenRecord => ({
    id,
    name,
    eventId: "20000000-0000-4000-8000-000000000001",
    assignment: null,
    revision: 1,
    session: { state: "active", activatedAt: at(7200), lastSeenAt: at(60), expiresAt: "2027-12-01T08:00:00.000Z" },
    createdAt: at(86_400),
  });
  const screens = [record("AAA234", "Atrium"), record("BBB234", "Balcony"), record("CCC234", "Cloakroom")];
  const view: ScreenMonitorView = {
    live: new Map([
      ["AAA234", status("AAA234")],
      // Warnings: weak Wi-Fi, cached agenda, and no screenshot for a while.
      [
        "BBB234",
        status("BBB234", {
          health: { ...status("BBB234").health!, mode: "auto", metrics: { network: { wifi: { signal: 40 } } } },
        }),
      ],
      ["CCC234", status("CCC234", { online: false, disconnectedAt: at(600), reportedAt: at(600) })],
    ]),
    quality: new Map(),
    screenshots: new Map([
      ["AAA234", { capturedAt: at(5), src: "data:image/jpeg;base64,/9j/4AAQ" }],
      ["BBB234", { capturedAt: at(200), src: "data:image/jpeg;base64,/9j/4AAQ" }],
    ]),
  };
  const lists: URL[] = [];
  beforeEach(() => {
    lists.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        lists.push(url);
        const ids = url.searchParams.get("screenIds")?.split(",");
        const rows = ids ? screens.filter((screen) => ids.includes(screen.id)) : screens;
        return new Response(
          JSON.stringify({ screens: rows, page: { limit: 25, offset: 0, total: rows.length, hasMore: false } }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
  });
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it("puts critical screens first, says each condition in one line and filters to those needing attention", async () => {
    host = document.body.appendChild(document.createElement("div"));
    await act(() =>
      render(
        <EventScreens slug={SLUG} canManage={false} now={NOW} monitor={{ view, now: NOW, control: false }} />,
        host!,
      ),
    );
    await settle();
    const titles = [...host.querySelectorAll(".pk-screen-card__title")].map((title) => title.textContent);
    expect(titles).toEqual(["Cloakroom", "Balcony", "Atrium"]);
    const cards = [...host.querySelectorAll("article")];
    const condition = (card: Element) => card.querySelector(".pk-screen-condition")!;
    expect(cards.map((card) => condition(card).getAttribute("title"))).toEqual([
      "Last heard 10 min ago · Offline",
      "Online · Weak Wi-Fi, no recent picture, running on the agenda",
      "Online · Following the studio",
    ]);
    expect(cards.map((card) => condition(card).getAttribute("data-tone"))).toEqual(["critical", "warning", "ok"]);
    // The tone along the top edge is for screens that need attention only, and is said to screen readers too.
    expect(cards.map((card) => card.className)).toEqual([
      "pk-collection-card pk-screen-card--critical",
      "pk-collection-card pk-screen-card--warning",
      "pk-collection-card",
    ]);
    expect(condition(cards[0]!).textContent).toBe("Critical: Last heard 10 min ago · Offline");
    expect(host.querySelector(".pk-badge")).toBeNull();

    const summary = [...host.querySelectorAll<HTMLButtonElement>(".pk-chip__toggle")].find((chip) =>
      chip.textContent?.includes("critical"),
    )!;
    expect(summary.textContent).toBe("1 critical · 1 warning");
    await act(() => summary.click());
    await settle();
    expect(lists.at(-1)!.searchParams.get("screenIds")).toBe("BBB234,CCC234");
    expect([...host.querySelectorAll(".pk-screen-card__title")].map((title) => title.textContent)).toEqual([
      "Cloakroom",
      "Balcony",
    ]);
  });
});

describe("browser notifications", () => {
  const shown: { title: string; tag?: string }[] = [];
  let permission: NotificationPermission = "default";
  const requestPermission = vi.fn(async () => {
    permission = "granted";
    return permission;
  });
  beforeEach(() => {
    shown.length = 0;
    permission = "default";
    requestPermission.mockClear();
    vi.stubGlobal(
      "Notification",
      Object.assign(
        class {
          constructor(title: string, options?: NotificationOptions) {
            shown.push({ title, tag: options?.tag });
          }
        },
        {
          get permission() {
            return permission;
          },
          requestPermission,
        },
      ),
    );
  });

  const critical: ScreenIssue = { code: "offline", label: "Offline", severity: "critical", since: at(200) };
  const warning: ScreenIssue = { code: "weak-wifi", label: "Weak Wi-Fi", severity: "warning", since: at(200) };

  it("asks only on the click, then fires once on entering critical and once on full recovery", async () => {
    let toggle: (() => Promise<void>) | undefined;
    let enabled = false;
    function Probe({ issues, ready = true }: { issues: Map<string, ScreenIssue[]>; ready?: boolean }) {
      const notifications = useScreenIssueNotifications({ issues, ready, nameOf: (id) => `Screen ${id}` });
      toggle = notifications.toggle;
      enabled = notifications.enabled;
      return null;
    }
    host = document.body.appendChild(document.createElement("div"));
    const show = (issues: [string, ScreenIssue[]][], ready = true) =>
      act(() => render(<Probe issues={new Map(issues)} ready={ready} />, host!));
    // Before the monitor's snapshot nothing counts; what is critical in it is not news.
    await show([], false);
    await show([
      ["A", [critical]],
      ["B", []],
    ]);
    expect(requestPermission).not.toHaveBeenCalled();
    await act(() => toggle!());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(enabled).toBe(true);
    expect(localStorage.getItem("pkic.screens.notify")).toBe("1");

    await show([
      ["A", [critical]],
      ["B", [warning]],
    ]);
    expect(shown).toEqual([]);
    await show([
      ["A", [critical]],
      ["B", [critical, warning]],
    ]);
    await show([
      ["A", [critical]],
      ["B", [{ ...critical, label: "Reconnecting", code: "livestream" }]],
    ]);
    await show([
      ["A", [critical]],
      ["B", [warning]],
    ]);
    expect(shown).toEqual([{ title: "Screen B: Offline", tag: "B" }]);
    await show([
      ["A", []],
      ["B", []],
    ]);
    expect(shown.slice(1)).toEqual([
      { title: "Screen A is back to normal", tag: "A" },
      { title: "Screen B is back to normal", tag: "B" },
    ]);

    await act(() => toggle!());
    expect(enabled).toBe(false);
    expect(localStorage.getItem("pkic.screens.notify")).toBeNull();
  });
});
