// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCREEN_POLICY } from "../../assets/shared/event-screen-policy";
import {
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorScreenMessageSchema,
  type ScreenDeviceMetrics,
  type ScreenHealth,
} from "../../assets/shared/schemas/event-screen-monitor";
import { screenReadResponseSchema } from "../../assets/shared/schemas/event-screens";
import { LIVE_PERSISTENT_RETRY_MAX_MS } from "../../assets/ts/live-session/live-socket-retry";
import type { ScreenApi } from "../../assets/ts/event-screens/screen-api";
import { ScreenApp } from "../../assets/ts/event-screens/ScreenApp";
import { createScreenClock } from "../../assets/ts/event-screens/screen-clock";
import { screenPageVersion } from "../../assets/ts/event-screens/screen-health";
import { useScreenMonitor } from "../../assets/ts/event-screens/useScreenMonitor";
import { fakeLiveSockets, type FakeLiveSocket } from "./helpers/live-room-socket";

const SCREEN = "K7M2QA";
const METRICS: ScreenDeviceMetrics = { uptime: 120, temps: { cpu: 48 } };
const HEALTH: Omit<ScreenHealth, "metrics"> = {
  pageVersion: "screen-page-test.js",
  display: "waiting",
  output: null,
  mode: "live",
  player: null,
  clockOffsetMs: 0,
};

/** What the screen sent its monitor, parsed by the monitor's own contract. */
const reports = (socket: FakeLiveSocket) =>
  socket.sent
    .filter((data) => data !== "ping")
    .map((data) => screenMonitorScreenMessageSchema.parse(JSON.parse(data)).health);

let host: HTMLElement | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
  vi.useRealTimers();
});
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("the screen's monitor connection", () => {
  function Probe(
    props: Partial<Parameters<typeof useScreenMonitor>[0]> & { factory: ReturnType<typeof fakeLiveSockets>["factory"] },
  ) {
    useScreenMonitor({
      screenId: SCREEN,
      enabled: true,
      connection: "pqc-2026",
      health: HEALTH,
      onCommand: () => undefined,
      readMetrics: async () => METRICS,
      createSocket: props.factory,
      ...props,
    });
    return null;
  }

  it("reports at once with the device's metrics, on every change and on its beat", async () => {
    const sockets = fakeLiveSockets();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe factory={sockets.factory} />, host!));
    expect(sockets.latest().url).toMatch(/\/api\/v1\/screens\/K7M2QA\/live$/);
    expect(sockets.latest().protocols).toEqual([SCREEN_MONITOR_PROTOCOL]);
    sockets.latest().open();
    await advance(0);
    expect(reports(sockets.latest())).toEqual([{ ...HEALTH, metrics: METRICS }]);

    await act(() => render(<Probe factory={sockets.factory} health={{ ...HEALTH, mode: "offline" }} />, host!));
    await advance(2_000);
    expect(reports(sockets.latest()).at(-1)?.mode).toBe("offline");

    const before = reports(sockets.latest()).length;
    await advance(SCREEN_POLICY.healthSeconds * 1000);
    expect(reports(sockets.latest()).length).toBe(before + 1);
  });

  it("forwards nothing of the device when its metrics cannot be read", async () => {
    const sockets = fakeLiveSockets();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe factory={sockets.factory} readMetrics={async () => null} />, host!));
    sockets.latest().open();
    await advance(0);
    expect(reports(sockets.latest())[0]?.metrics).toBeNull();
  });

  it("carries out commands and reconnects after any close, with backoff", async () => {
    const sockets = fakeLiveSockets();
    const onCommand = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe factory={sockets.factory} onCommand={onCommand} />, host!));
    sockets.latest().open();
    const until = new Date(Date.now() + 10_000).toISOString();
    sockets
      .latest()
      .dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "screen.identify", until }) }));
    sockets.latest().dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "screen.unknown" }) }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ type: "screen.identify", until });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await act(() => sockets.latest().refuse(4401, "SCREEN_SESSION_MISSING"));
      await advance(LIVE_PERSISTENT_RETRY_MAX_MS);
    }
    expect(sockets.sockets).toHaveLength(7);
  });

  it("stays closed while the screen is not paired", async () => {
    const sockets = fakeLiveSockets();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<Probe factory={sockets.factory} enabled={false} />, host!));
    expect(sockets.sockets).toHaveLength(0);
  });
});

describe("the screen's commands", () => {
  async function mountApp(onReload = vi.fn()) {
    const sockets = fakeLiveSockets();
    const response = screenReadResponseSchema.parse({
      viewer: "screen",
      screen: { id: SCREEN, name: "Foyer, by registration", assignment: null },
      serverNow: new Date().toISOString(),
      agenda: null,
      livestream: null,
      overlay: null,
    });
    const api: ScreenApi = {
      read: vi.fn(async () => ({ response, sentAt: Date.now(), receivedAt: Date.now() })),
      startPairing: vi.fn(),
      pollSession: vi.fn(),
    } as unknown as ScreenApi;
    host = document.body.appendChild(document.createElement("div"));
    await act(() =>
      render(
        <ScreenApp
          screenId={SCREEN}
          storage={localStorage}
          clock={createScreenClock()}
          api={api}
          onHandoff={vi.fn()}
          onReload={onReload}
          monitor={{ createSocket: sockets.factory, readMetrics: async () => null }}
        />,
        host!,
      ),
    );
    await advance(0);
    sockets.latest().open();
    await advance(0);
    return { sockets, onReload };
  }
  const deliver = (socket: FakeLiveSocket, command: unknown) =>
    act(() => {
      socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(command) }));
    });

  it("reports what it shows, and shows its name and ID over it for the time Identify asks", async () => {
    localStorage.clear();
    const { sockets } = await mountApp();
    expect(reports(sockets.latest())[0]).toMatchObject({ display: "waiting", output: null, mode: "live" });
    expect(reports(sockets.latest())[0]?.pageVersion).toBe(screenPageVersion());

    await deliver(sockets.latest(), {
      type: "screen.identify",
      until: new Date(Date.now() + SCREEN_POLICY.identifySeconds * 1000).toISOString(),
    });
    const identify = () => host!.querySelector(".pk-screen-identify");
    expect(identify()?.textContent).toContain("Foyer, by registration");
    expect(identify()?.textContent).toContain(SCREEN);
    await advance(SCREEN_POLICY.identifySeconds * 1000 + 1_000);
    expect(identify()).toBeNull();
  });

  it("reloads on a screen manager's Reload", async () => {
    localStorage.clear();
    const { sockets, onReload } = await mountApp();
    await deliver(sockets.latest(), { type: "screen.reload" });
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
