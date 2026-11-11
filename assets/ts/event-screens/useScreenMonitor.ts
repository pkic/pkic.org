import { useEffect, useRef } from "preact/hooks";
import { SCREEN_POLICY } from "../../shared/event-screen-policy";
import {
  SCREEN_MONITOR_LIMITS,
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorCommandSchema,
  screenMonitorScreenMessageSchema,
  type ScreenDeviceMetrics,
  type ScreenHealth,
  type ScreenMonitorCommand,
} from "../../shared/schemas/event-screen-monitor";
import type { ScreenId } from "../../shared/schemas/event-screens";
import { LIVE_PERSISTENT_RETRY_MAX_MS, persistentRetryDelay } from "../live-session/live-socket-retry";
import type { LiveSocketFactory } from "../live-session/useLiveRoom";
import { readScreenDeviceMetrics, type ScreenMetricsReader } from "./screen-device-metrics";

const browserSocket: LiveSocketFactory = (url, protocols) => new WebSocket(url, protocols);
const KEEP_ALIVE_MS = 25_000;
/** A change reaches staff at once, but never more often than this. */
const MIN_REPORT_GAP_MS = 2_000;
/** After the device's metrics could not be read, ask again only this often. */
const METRICS_RETRY_MS = 60_000;

export function screenMonitorSocketUrl(location: Pick<Location, "protocol" | "host">, screenId: ScreenId) {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/v1/screens/${encodeURIComponent(screenId)}/live`;
}

/**
 * The screen's report to its event's monitor: its health when it connects,
 * whenever what it shows changes, and every few seconds besides, with the
 * device's metrics when they can be read. It never gives up reconnecting,
 * and it carries out a screen manager's Identify and Reload. It runs beside
 * the picture: nothing here can stop what the screen shows.
 */
export function useScreenMonitor({
  screenId,
  enabled,
  connection,
  health,
  onCommand,
  createSocket = browserSocket,
  readMetrics = readScreenDeviceMetrics,
}: {
  screenId: ScreenId;
  /** Paired; an unpaired screen has no sign-in to report with. */
  enabled: boolean;
  /** Changes when the screen may belong to another event, so it reconnects to that event's monitor. */
  connection: string;
  health: Omit<ScreenHealth, "metrics">;
  onCommand: (command: ScreenMonitorCommand) => void;
  createSocket?: LiveSocketFactory;
  readMetrics?: ScreenMetricsReader;
}) {
  const latest = useRef(health);
  latest.current = health;
  const command = useRef(onCommand);
  command.current = onCommand;
  // Read at each attempt, so a caller's new function never reconnects the screen.
  const factories = useRef({ createSocket, readMetrics });
  factories.current = { createSocket, readMetrics };
  const report = useRef<(() => void) | null>(null);
  const signature = JSON.stringify(health);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    let every: ReturnType<typeof setInterval> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let lastSent = 0;
    let metrics: ScreenDeviceMetrics | null = null;
    let metricsTriedAt = Number.NEGATIVE_INFINITY;
    let metricsFailed = false;

    async function refreshMetrics() {
      const now = Date.now();
      if (metricsFailed && now - metricsTriedAt < METRICS_RETRY_MS) return;
      metricsTriedAt = now;
      metrics = await factories.current.readMetrics();
      metricsFailed = metrics === null;
    }

    function sendNow() {
      pending = undefined;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const message = screenMonitorScreenMessageSchema.parse({
        type: "screen.health",
        health: { ...latest.current, metrics },
      });
      const text = JSON.stringify(message);
      // A report over the monitor's limit would close the socket; send it without the metrics instead.
      socket.send(
        text.length <= SCREEN_MONITOR_LIMITS.messageBytes
          ? text
          : JSON.stringify({ ...message, health: { ...message.health, metrics: null } }),
      );
      lastSent = Date.now();
    }

    function sendSoon() {
      if (pending) return;
      pending = setTimeout(sendNow, Math.max(0, MIN_REPORT_GAP_MS - (Date.now() - lastSent)));
    }
    report.current = sendSoon;

    function open() {
      const current = factories.current.createSocket(screenMonitorSocketUrl(window.location, screenId), [
        SCREEN_MONITOR_PROTOCOL,
      ]);
      socket = current;
      let openedAt: number | null = null;
      current.addEventListener("open", () => {
        openedAt = Date.now();
        keepAlive = setInterval(() => current.send("ping"), KEEP_ALIVE_MS);
        every = setInterval(() => {
          void refreshMetrics().then(sendNow);
        }, SCREEN_POLICY.healthSeconds * 1000);
        void refreshMetrics().then(sendNow);
      });
      current.addEventListener("message", (event) => {
        if (stopped || socket !== current || event.data === "pong") return;
        let parsed;
        try {
          parsed = screenMonitorCommandSchema.safeParse(JSON.parse(String(event.data)));
        } catch {
          return;
        }
        if (parsed.success) command.current(parsed.data);
      });
      current.addEventListener("close", () => {
        clearInterval(keepAlive);
        clearInterval(every);
        if (socket === current) socket = null;
        if (stopped) return;
        // A refused admission opens and closes at once; one that held a while starts its backoff over.
        if (openedAt !== null && Date.now() - openedAt >= LIVE_PERSISTENT_RETRY_MAX_MS) attempt = 0;
        retry = setTimeout(open, persistentRetryDelay(attempt));
        attempt += 1;
      });
    }

    open();
    return () => {
      stopped = true;
      report.current = null;
      clearTimeout(retry);
      clearTimeout(pending);
      clearInterval(keepAlive);
      clearInterval(every);
      socket?.close(1000, "Screen left");
      socket = null;
    };
  }, [enabled, connection, screenId]);

  // What the screen shows changed: tell staff now rather than at the next beat.
  const reported = useRef(signature);
  useEffect(() => {
    if (reported.current === signature) return;
    reported.current = signature;
    report.current?.();
  }, [signature]);
}
