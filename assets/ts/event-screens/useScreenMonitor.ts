import { useEffect, useRef } from "preact/hooks";
import { SCREEN_POLICY } from "../../shared/event-screen-policy";
import {
  SCREEN_MONITOR_LIMITS,
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorCommandSchema,
  screenMonitorScreenMessageSchema,
  type ScreenDeviceMetrics,
  type ScreenHealth,
  type ScreenManagerCommand,
} from "../../shared/schemas/event-screen-monitor";
import type { ScreenId } from "../../shared/schemas/event-screens";
import { LIVE_PERSISTENT_RETRY_MAX_MS, persistentRetryDelay } from "../live-session/live-socket-retry";
import type { LiveSocketFactory } from "../live-session/useLiveRoom";
import { readLivestreamPlayback, type LivestreamPlaybackReader } from "./livestream-player-report";
import { readScreenDeviceMetrics, type ScreenMetricsReader } from "./screen-device-metrics";
import { readScreenDeviceScreenshot, type ScreenScreenshotReader } from "./screen-device-screenshot";

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
 * device's metrics and the player's readings when they can be read. It
 * sends the device's screenshot at the pace the monitor asks, never gives up
 * reconnecting, and carries out a screen manager's Identify and Reload. It
 * runs beside the picture: nothing here can stop what the screen shows.
 */
export function useScreenMonitor({
  screenId,
  enabled,
  connection,
  health,
  onCommand,
  createSocket = browserSocket,
  readMetrics = readScreenDeviceMetrics,
  readScreenshot = readScreenDeviceScreenshot,
  readPlayback = readLivestreamPlayback,
}: {
  screenId: ScreenId;
  /** Paired; an unpaired screen has no sign-in to report with. */
  enabled: boolean;
  /** Changes when the screen may belong to another event, so it reconnects to that event's monitor. */
  connection: string;
  health: Omit<ScreenHealth, "metrics">;
  onCommand: (command: ScreenManagerCommand) => void;
  createSocket?: LiveSocketFactory;
  readMetrics?: ScreenMetricsReader;
  readScreenshot?: ScreenScreenshotReader;
  readPlayback?: LivestreamPlaybackReader;
}) {
  const latest = useRef(health);
  latest.current = health;
  const command = useRef(onCommand);
  command.current = onCommand;
  // Read at each attempt, so a caller's new function never reconnects the screen.
  const factories = useRef({ createSocket, readMetrics, readScreenshot, readPlayback });
  factories.current = { createSocket, readMetrics, readScreenshot, readPlayback };
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
    // The monitor sets the pace; until it says, the unwatched one. Kept across reconnects.
    let captureEveryMs = SCREEN_POLICY.screenshotSeconds * 1000;
    let capturedAt = Number.NEGATIVE_INFINITY;
    let capture: ReturnType<typeof setTimeout> | undefined;
    let capturing = false;

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
      const { player } = latest.current;
      const message = screenMonitorScreenMessageSchema.parse({
        type: "screen.health",
        health: {
          ...latest.current,
          player: player ? { ...player, playback: factories.current.readPlayback() } : null,
          metrics,
        },
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

    /** The next screenshot falls due one pace after the last; a faster pace may bring it forward. */
    function scheduleCapture() {
      clearTimeout(capture);
      if (stopped || !socket || socket.readyState !== WebSocket.OPEN) return;
      capture = setTimeout(() => void captureNow(), Math.max(0, capturedAt + captureEveryMs - Date.now()));
    }

    async function captureNow() {
      if (capturing) return;
      capturing = true;
      capturedAt = Date.now();
      try {
        const bytes = await factories.current.readScreenshot();
        if (bytes && socket?.readyState === WebSocket.OPEN) socket.send(bytes);
      } finally {
        capturing = false;
        scheduleCapture();
      }
    }

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
        scheduleCapture();
      });
      current.addEventListener("message", (event) => {
        if (stopped || socket !== current || event.data === "pong") return;
        let parsed;
        try {
          parsed = screenMonitorCommandSchema.safeParse(JSON.parse(String(event.data)));
        } catch {
          return;
        }
        if (!parsed.success) return;
        if (parsed.data.type !== "screen.capture") {
          command.current(parsed.data);
          return;
        }
        captureEveryMs = parsed.data.everySeconds * 1000;
        if (!capturing) scheduleCapture();
      });
      current.addEventListener("close", () => {
        clearInterval(keepAlive);
        clearInterval(every);
        clearTimeout(capture);
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
      clearTimeout(capture);
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
