import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  LIVE_OVERLAY_PROTOCOL_PREFIX,
  LIVE_ROOM_PROTOCOL,
  liveRoomClientMessageSchema,
  liveRoomFaultFromClose,
  liveRoomRefusalFromClose,
  liveRoomServerMessageSchema,
  type LiveRoomClientMessage,
  type LiveRoomServerMessage,
} from "../../shared/schemas/live-session-room";
import { persistentRetryDelay, retryWhenBack, watchLiveSocket, type LivePersistence } from "./live-socket-retry";

/**
 * `connecting` before the first snapshot, `live` while the socket is open,
 * `offline` while it reconnects: the last state stays on screen, read-only.
 * There is no polling fallback; a room that cannot be reached stays offline.
 * A room that refused admission stays offline with the refusal's error code
 * and is not retried, unless the connection is persistent (a venue screen),
 * which retries after anything and keeps its last state on screen.
 */
export type LiveRoomStatus = "connecting" | "live" | "offline";

export type LiveSocketFactory = (url: string, protocols: string[]) => WebSocket;

const browserSocket: LiveSocketFactory = (url, protocols) => new WebSocket(url, protocols);
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * One live socket of the room protocol, reconnecting with backoff while mounted and enabled: a session's room
 * or a location's chat. `reduce` folds each message into the state once the room answered with `snapshot`;
 * `intercept` takes the messages that bypass the state, answering true for each it consumed.
 */
export function useLiveSocket<State>({
  url,
  urlKey,
  enabled = true,
  snapshot,
  reduce,
  intercept,
  onConnecting,
  overlayToken,
  createSocket = browserSocket,
  persistent,
}: {
  /** The socket's address, read at each attempt; a change reconnects. */
  url: () => string;
  /** The address's identity: the effect reconnects when it changes. */
  urlKey: string;
  enabled?: boolean;
  snapshot: LiveRoomServerMessage["type"];
  reduce: (state: State | null, message: LiveRoomServerMessage) => State | null;
  intercept?: (message: LiveRoomServerMessage) => boolean;
  /** A new connection starts: results of the last one no longer apply. */
  onConnecting?: () => void;
  overlayToken?: string;
  createSocket?: LiveSocketFactory;
  persistent?: LivePersistence;
}) {
  const [state, setState] = useState<State | null>(null);
  const [status, setStatus] = useState<LiveRoomStatus>("connecting");
  const [admissionRefusal, setAdmissionRefusal] = useState<string | null>(null);
  // The reference of a fault on our side at the last close, so the page does not blame the connection for it.
  const [serverFault, setServerFault] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const handlers = useRef({ url, reduce, intercept, onConnecting, createSocket, persistent });
  handlers.current = { url, reduce, intercept, onConnecting, createSocket, persistent };
  const access = useRef(overlayToken);
  access.current = overlayToken;
  const keepsTrying = Boolean(persistent);
  // A persistent connection takes renewed access at its next attempt instead of reconnecting for it.
  const accessKey = keepsTrying ? null : overlayToken;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let admitted = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watch: ReturnType<typeof watchLiveSocket> | undefined;

    function open() {
      const token = access.current;
      const protocols = [LIVE_ROOM_PROTOCOL, ...(token ? [LIVE_OVERLAY_PROTOCOL_PREFIX + token] : [])];
      const current = handlers.current.createSocket(handlers.current.url(), protocols);
      socket.current = current;
      let mine: ReturnType<typeof watchLiveSocket> | undefined;
      current.addEventListener("open", () => {
        // A refused admission opens before it closes: a persistent feed only
        // starts over once the room actually answers with its snapshot.
        if (!keepsTrying) attempt = 0;
        mine = watchLiveSocket(current, () => {
          // Silent too long: the network changed or the computer slept. Drop it and start over.
          closed(current, mine, { code: 1006, reason: "" });
          current.close(4000, "No answer");
        });
        watch = mine;
      });
      current.addEventListener("message", (event) => {
        if (stopped || socket.current !== current) return;
        mine?.heard();
        handlers.current.persistent?.onActivity?.();
        if (event.data === "pong") return;
        let parsed;
        try {
          parsed = liveRoomServerMessageSchema.safeParse(JSON.parse(String(event.data)));
        } catch {
          return;
        }
        if (!parsed.success) {
          // A screen cannot follow a room it cannot read: it holds its last state until the next snapshot.
          if (keepsTrying) {
            setStatus("offline");
            handlers.current.persistent?.onUnreadable?.();
          }
          return;
        }
        const message = parsed.data;
        if (handlers.current.intercept?.(message)) return;
        if (message.type === snapshot) {
          admitted = true;
          attempt = 0;
          setStatus("live");
          setServerFault(null);
        }
        // Moving to another room keeps the last one's state on screen; nothing of the new room lands on it before its snapshot.
        if (admitted) setState((previous) => handlers.current.reduce(previous, message));
      });
      current.addEventListener("close", (event) => closed(current, mine, event));
    }

    /** One socket's end, by its close or by the watch; the first of the two starts the next attempt. */
    function closed(
      current: WebSocket,
      itsWatch: ReturnType<typeof watchLiveSocket> | undefined,
      event: { code: number; reason: string },
    ) {
      itsWatch?.stop();
      if (socket.current !== current) return;
      socket.current = null;
      if (stopped) return;
      setStatus("offline");
      const refused = liveRoomRefusalFromClose(event.code, event.reason);
      if (refused) setAdmissionRefusal(refused);
      setServerFault(liveRoomFaultFromClose(event.code, event.reason));
      if (keepsTrying) {
        if (refused) handlers.current.persistent?.onRefusal?.(refused);
        retry = setTimeout(open, persistentRetryDelay(attempt));
        attempt += 1;
        return;
      }
      // A refusal is final, and a room that was never reached is not retried forever.
      if (refused || (!admitted && attempt >= RETRY_DELAYS_MS.length)) {
        retry = undefined;
        return;
      }
      retry = setTimeout(open, RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
      attempt += 1;
    }

    handlers.current.onConnecting?.();
    setStatus("connecting");
    setAdmissionRefusal(null);
    setServerFault(null);
    open();
    const stopWaiting = retryWhenBack(() => {
      // Waiting out a backoff while the network was away: try now.
      if (stopped || socket.current || retry === undefined) return;
      clearTimeout(retry);
      open();
    });
    return () => {
      stopped = true;
      stopWaiting();
      clearTimeout(retry);
      watch?.stop();
      socket.current?.close(1000, "Left the room");
      socket.current = null;
    };
  }, [urlKey, enabled, accessKey, keepsTrying, snapshot]);

  /** Sends one contract message; false when the room is not connected. */
  const send = useCallback((message: LiveRoomClientMessage): boolean => {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN) return false;
    current.send(JSON.stringify(liveRoomClientMessageSchema.parse(message)));
    return true;
  }, []);

  return { state, status, admissionRefusal, serverFault, send };
}
