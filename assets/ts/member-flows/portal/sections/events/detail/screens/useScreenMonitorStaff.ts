/**
 * Staff's connection to the event's screen monitor: every screen's live
 * status, last hour and latest screenshot as they change, and Identify and
 * Reload for screen managers. It reconnects after any drop; a refusal (no
 * access to the event's screens) stops it, and the page shows only what the
 * screen list recorded.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorServerMessageSchema,
  screenMonitorStaffMessageSchema,
  type ScreenMonitorStaffMessage,
} from "../../../../../../../shared/schemas/event-screen-monitor";
import {
  liveRoomRefusalCloseCode,
  liveRoomRefusalFromClose,
} from "../../../../../../../shared/schemas/live-session-room";
import type { ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { persistentRetryDelay } from "../../../../../../live-session/live-socket-retry";
import type { LiveSocketFactory } from "../../../../../../live-session/useLiveRoom";
import { toast } from "../../../../ui";
import {
  applyScreenMonitorMessage,
  EMPTY_SCREEN_MONITOR_VIEW,
  STAFF_CLOCK_SAMPLES,
  staffClockOffset,
  type ScreenMonitorView,
} from "./screen-monitor-view";

const browserSocket: LiveSocketFactory = (url, protocols) => new WebSocket(url, protocols);
const KEEP_ALIVE_MS = 25_000;
/** The monitor holds its most staff connections; another may fit shortly. */
const FULL_CLOSE_CODE = liveRoomRefusalCloseCode(429);
/** A new offset within this much of the current one changes nothing on screen. */
const CLOCK_SETTLE_MS = 250;
const COMMAND_LABELS: Record<ScreenMonitorStaffMessage["type"], string> = {
  "screen.identify": "Identify",
  "screen.reload": "Reload",
};

export function screenMonitorStaffSocketUrl(location: Pick<Location, "protocol" | "host">, slug: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/v1/events/${encodeURIComponent(slug)}/screens/live`;
}

export type ScreenMonitorStaffStatus = "connecting" | "live" | "offline" | "refused";

export function useScreenMonitorStaff({
  slug,
  enabled = true,
  createSocket = browserSocket,
}: {
  slug: string;
  enabled?: boolean;
  createSocket?: LiveSocketFactory;
}) {
  const [view, setView] = useState<ScreenMonitorView>(EMPTY_SCREEN_MONITOR_VIEW);
  const [control, setControl] = useState(false);
  const [status, setStatus] = useState<ScreenMonitorStaffStatus>("connecting");
  /** The monitor's clock minus this browser's, so ages never depend on how far off this browser's clock is. */
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const clockSamples = useRef<number[]>([]);
  /** The monitor's clock at its latest message, so a lost connection can say how old the view is. */
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const factory = useRef(createSocket);
  factory.current = createSocket;
  /** The screen each sent command is for, to name it in the reply. */
  const pending = useRef(new Map<string, { screen: ScreenRecord; type: ScreenMonitorStaffMessage["type"] }>());

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;

    function open() {
      const current = factory.current(screenMonitorStaffSocketUrl(window.location, slug), [SCREEN_MONITOR_PROTOCOL]);
      socket.current = current;
      current.addEventListener("open", () => {
        keepAlive = setInterval(() => current.send("ping"), KEEP_ALIVE_MS);
      });
      current.addEventListener("message", (event) => {
        if (stopped || socket.current !== current || event.data === "pong") return;
        let parsed;
        try {
          parsed = screenMonitorServerMessageSchema.safeParse(JSON.parse(String(event.data)));
        } catch {
          return;
        }
        if (!parsed.success) return;
        const message = parsed.data;
        if ("serverNow" in message) {
          clockSamples.current = [...clockSamples.current, message.serverNow - Date.now()].slice(-STAFF_CLOCK_SAMPLES);
          const offset = staffClockOffset(clockSamples.current);
          setClockOffsetMs((current) => (Math.abs(offset - current) < CLOCK_SETTLE_MS ? current : offset));
          setLastUpdateAt(message.serverNow);
        }
        if (message.type === "screens.snapshot") {
          attempt = 0;
          setControl(message.control);
          setStatus("live");
        }
        if (message.type === "screens.sent" || message.type === "screens.refused") {
          const operation = message.operationId ? pending.current.get(message.operationId) : undefined;
          if (message.operationId) pending.current.delete(message.operationId);
          if (message.type === "screens.sent" && operation)
            toast(`${COMMAND_LABELS[operation.type]} sent to “${operation.screen.name}”`, "success");
          else if (message.type === "screens.refused") toast(message.message, "error");
          return;
        }
        setView((previous) => applyScreenMonitorMessage(previous, message));
      });
      current.addEventListener("close", (event) => {
        clearInterval(keepAlive);
        if (socket.current === current) socket.current = null;
        // The next connection measures the clock afresh: this one's samples may predate a clock jump.
        clockSamples.current = [];
        if (stopped) return;
        // A full monitor is temporary and retried; any other refusal is final.
        if (event.code !== FULL_CLOSE_CODE && liveRoomRefusalFromClose(event.code, event.reason)) {
          setStatus("refused");
          return;
        }
        setStatus("offline");
        retry = setTimeout(open, persistentRetryDelay(attempt));
        attempt += 1;
      });
    }

    setStatus("connecting");
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(keepAlive);
      socket.current?.close(1000, "Left the screens");
      socket.current = null;
      clockSamples.current = [];
      // Only a snapshot on the next connection makes the view live again.
      setStatus("connecting");
    };
  }, [slug, enabled]);

  /** Sends Identify or Reload to one screen; says so when the monitor is not connected. */
  const command = useCallback((type: ScreenMonitorStaffMessage["type"], screen: ScreenRecord) => {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN) {
      toast("The screen monitor is reconnecting. Try again in a moment.", "error");
      return;
    }
    const operationId = crypto.randomUUID();
    pending.current.set(operationId, { screen, type });
    current.send(JSON.stringify(screenMonitorStaffMessageSchema.parse({ type, screenId: screen.id, operationId })));
  }, []);

  return { view, control, status, clockOffsetMs, lastUpdateAt, command };
}
