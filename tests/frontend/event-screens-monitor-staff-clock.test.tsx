// @vitest-environment jsdom
/**
 * Staff's side of the screen monitor over time: reading ages on the monitor's
 * clock, a lost connection, and switching monitoring off and on again.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screenIssues } from "../../assets/shared/event-screen-issues";
import type { ScreenRecord } from "../../assets/shared/schemas/event-screens";
import {
  ScreenMonitorLost,
  screenCondition,
} from "../../assets/ts/member-flows/portal/sections/events/detail/screens/ScreenMonitorCard";
import { staffClockOffset } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/screen-monitor-view";
import { useScreenMonitorController } from "../../assets/ts/member-flows/portal/sections/events/detail/screens/useScreenMonitorController";
import { fakeLiveSockets } from "./helpers/live-room-socket";
import { at, message, NOW, SLUG, status } from "./helpers/screen-monitor-staff-fixture";

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

  it("shows a lost connection and no screen as online until the monitor is back", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const sockets = fakeLiveSockets();
    let latest: ReturnType<typeof useScreenMonitorController> | undefined;
    function Probe() {
      latest = useScreenMonitorController({ slug: SLUG, createSocket: sockets.factory });
      const { lostSince, now, view } = latest;
      const record = { id: "K7M2QA", name: "Foyer", session: { state: "active" } } as ScreenRecord;
      return (
        <>
          <ScreenMonitorLost lostSince={lostSince} now={now} />
          <p id="condition">
            {screenCondition(record, view?.live.get("K7M2QA"), latest.issuesOf("K7M2QA"), now, lostSince).text}
          </p>
        </>
      );
    }
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe />, host!));
    await act(() => sockets.latest().open());
    const offline = status("K7M2QA", { reportedAt: at(200) });
    await act(() => {
      sockets.latest().dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify(
            message({ type: "screens.snapshot", serverNow: NOW, control: false, screens: [offline], quality: [] }),
          ),
        }),
      );
    });
    expect(latest!.lostSince).toBeNull();
    expect(latest!.issuesOf("K7M2QA").map((issue) => [issue.label, issue.severity])).toEqual([
      ["Not responding", "critical"],
    ]);
    expect(host.querySelector("#condition")!.textContent).toBe("Online · Not responding, following the studio");

    await act(() => sockets.latest().close());
    // The view's clock moves every five seconds; each step renders.
    for (let step = 0; step < 13; step += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    expect(latest!.lostSince).toBe(NOW);
    expect(latest!.issuesOf("K7M2QA")).toEqual([]);
    expect(host.querySelector("#condition")!.textContent).toBe("Status unknown · last update 1 min ago");
    expect(host.querySelector(".pk-alert")!.textContent).toBe(
      "Connection to the screen monitor lost. Reconnecting… Last update 1 min ago.",
    );
  });

  it("derives nothing from the kept view once switched off, as when the studio panel closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const sockets = fakeLiveSockets();
    let latest: ReturnType<typeof useScreenMonitorController> | undefined;
    function Probe({ enabled }: { enabled: boolean }) {
      latest = useScreenMonitorController({ slug: SLUG, enabled, createSocket: sockets.factory });
      return null;
    }
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe enabled />, host!));
    await act(() => sockets.latest().open());
    await act(() => {
      sockets.latest().dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify(
            message({
              type: "screens.snapshot",
              serverNow: NOW,
              control: false,
              screens: [status("K7M2QA")],
              quality: [],
            }),
          ),
        }),
      );
    });
    await act(() => render(<Probe enabled={false} />, host!));
    // Three minutes on, the kept heartbeat would read as critical.
    for (let step = 0; step < 36; step += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    expect(latest!.issues.size).toBe(0);
  });

  it("notifies only from a snapshot of the current connection after the panel reopens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const shown: string[] = [];
    vi.stubGlobal(
      "Notification",
      Object.assign(
        class {
          constructor(title: string) {
            shown.push(title);
          }
        },
        { permission: "granted", requestPermission: async () => "granted" },
      ),
    );
    localStorage.setItem("pkic.screens.notify", "1");
    const sockets = fakeLiveSockets();
    let latest: ReturnType<typeof useScreenMonitorController> | undefined;
    function Probe({ enabled }: { enabled: boolean }) {
      latest = useScreenMonitorController({ slug: SLUG, enabled, createSocket: sockets.factory });
      return null;
    }
    const snapshot = (serverNow: number) =>
      act(() => {
        sockets.latest().dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify(
              message({
                type: "screens.snapshot",
                serverNow,
                control: false,
                screens: [status("K7M2QA", { reportedAt: at(5) })],
                quality: [],
              }),
            ),
          }),
        );
      });
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe enabled />, host!));
    await act(() => sockets.latest().open());
    await snapshot(NOW);
    expect(latest!.notifications.enabled).toBe(true);
    await act(() => render(<Probe enabled={false} />, host!));
    for (let step = 0; step < 36; step += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    // Reopened: the kept heartbeat is three minutes old, but no snapshot of this connection has arrived.
    await act(() => render(<Probe enabled />, host!));
    expect(latest!.issues.size).toBe(0);
    // The first snapshot of this connection, on the monitor's clock now, is looked at afresh, as when the page opened.
    await act(() => sockets.latest().open());
    await snapshot(Date.now());
    expect(latest!.issuesOf("K7M2QA").map((issue) => issue.severity)).toEqual(["critical"]);
    expect(shown).toEqual([]);
  });

  it("measures the clock afresh on each connection, so a clock jump while closed raises nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const shown: string[] = [];
    vi.stubGlobal(
      "Notification",
      Object.assign(
        class {
          constructor(title: string) {
            shown.push(title);
          }
        },
        { permission: "granted", requestPermission: async () => "granted" },
      ),
    );
    localStorage.setItem("pkic.screens.notify", "1");
    const sockets = fakeLiveSockets();
    let latest: ReturnType<typeof useScreenMonitorController> | undefined;
    function Probe({ enabled }: { enabled: boolean }) {
      latest = useScreenMonitorController({ slug: SLUG, enabled, createSocket: sockets.factory });
      return null;
    }
    const snapshot = (serverNow: number) =>
      act(() => {
        sockets.latest().dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify(
              message({
                type: "screens.snapshot",
                serverNow,
                control: false,
                screens: [status("K7M2QA", { reportedAt: new Date(serverNow - 4_000).toISOString() })],
                quality: [],
              }),
            ),
          }),
        );
      });
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe enabled />, host!));
    await act(() => sockets.latest().open());
    // This browser and the monitor agree: offset 0.
    await snapshot(NOW);
    await act(() => render(<Probe enabled={false} />, host!));
    // Asleep while closed: this browser's clock jumps five minutes; the monitor's moves a second.
    vi.setSystemTime(NOW + 5 * 60_000);
    await act(() => render(<Probe enabled />, host!));
    await act(() => sockets.latest().open());
    await snapshot(NOW + 1_000);
    // Let the view's five-second clock catch up with this browser's.
    for (let step = 0; step < 2; step += 1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    expect(latest!.now).toBeLessThan(NOW + 60_000);
    expect(latest!.issues.get("K7M2QA")).toEqual([]);
    expect(shown).toEqual([]);
  });

  it("chooses the offset with the least delay among recent messages", () => {
    expect(staffClockOffset([])).toBe(0);
    expect(staffClockOffset([-90_400, -90_050, -90_900])).toBe(-90_050);
  });
});
