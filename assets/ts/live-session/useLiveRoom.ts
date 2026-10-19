import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  LIVE_OVERLAY_PROTOCOL_PREFIX,
  LIVE_ROOM_PROTOCOL,
  liveRoomClientMessageSchema,
  liveRoomRefusalFromClose,
  liveRoomSocketQuerySchema,
  type LiveOverlayView,
  liveRoomServerMessageSchema,
  type LiveRoomClientMessage,
  type LiveRoomServerMessage,
} from "../../shared/schemas/live-session-room";

export type LivePresenceMessage = Extract<LiveRoomServerMessage, { type: "presence.changed" | "presence.left" }>;
import { applyLiveRoomMessage, type LiveRoomState } from "./live-room-state";

/**
 * `connecting` before the first snapshot, `live` while the socket is open,
 * `offline` while it reconnects: the last state stays on screen, read-only.
 * There is no polling fallback; a room that cannot be reached stays offline.
 * A room that refused admission stays offline with the refusal's error code
 * and is not retried.
 */
export type LiveRoomStatus = "connecting" | "live" | "offline";

export type LiveSocketFactory = (url: string, protocols: string[]) => WebSocket;

const browserSocket: LiveSocketFactory = (url, protocols) => new WebSocket(url, protocols);
const KEEP_ALIVE_MS = 25_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function liveRoomSocketUrl(
  location: Pick<Location, "protocol" | "host">,
  slug: string,
  occurrenceId: string,
  output?: LiveOverlayView,
) {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const query = output ? `?${new URLSearchParams(liveRoomSocketQuerySchema.parse({ output }))}` : "";
  return `${scheme}//${location.host}/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/live${query}`;
}

/** One session's live room over its socket, reconnecting with backoff while mounted and enabled. */
export function useLiveRoom({
  slug,
  occurrenceId,
  enabled = true,
  overlayToken,
  output,
  createSocket = browserSocket,
  onPresence,
}: {
  slug: string;
  occurrenceId: string;
  enabled?: boolean;
  /** A broadcast overlay's read-only access; a signed-in page uses its own session instead. */
  overlayToken?: string;
  /** The output a broadcast source draws, so the room sends it what that output alone may show. */
  output?: LiveOverlayView;
  createSocket?: LiveSocketFactory;
  /** Receives other operators' presence, which bypasses the room state so it never re-renders the whole page. */
  onPresence?: (message: LivePresenceMessage) => void;
}) {
  const [questionChangeResult, setQuestionChangeResult] = useState<Extract<
    LiveRoomServerMessage,
    { type: "question.updated" | "room.refused" }
  > | null>(null);
  const [answerResult, setAnswerResult] = useState<Extract<
    LiveRoomServerMessage,
    { type: "question.answer.result" | "room.refused" }
  > | null>(null);
  const [questionResult, setQuestionResult] = useState<Extract<
    LiveRoomServerMessage,
    { type: "question.accepted" | "room.refused" }
  > | null>(null);
  const [state, setState] = useState<LiveRoomState | null>(null);
  const [status, setStatus] = useState<LiveRoomStatus>("connecting");
  const [admissionRefusal, setAdmissionRefusal] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const factory = useRef(createSocket);
  factory.current = createSocket;
  const presence = useRef(onPresence);
  presence.current = onPresence;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let admitted = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    const protocols = [LIVE_ROOM_PROTOCOL, ...(overlayToken ? [LIVE_OVERLAY_PROTOCOL_PREFIX + overlayToken] : [])];

    function open() {
      const current = factory.current(liveRoomSocketUrl(window.location, slug, occurrenceId, output), protocols);
      socket.current = current;
      current.addEventListener("open", () => {
        attempt = 0;
        keepAlive = setInterval(() => current.send("ping"), KEEP_ALIVE_MS);
      });
      current.addEventListener("message", (event) => {
        if (stopped || socket.current !== current) return;
        if (event.data === "pong") return;
        let parsed;
        try {
          parsed = liveRoomServerMessageSchema.safeParse(JSON.parse(String(event.data)));
        } catch {
          return;
        }
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "presence.changed" || message.type === "presence.left") {
          presence.current?.(message);
          return;
        }
        if (message.type === "question.updated") {
          setQuestionChangeResult(message);
          return;
        }
        if (message.type === "room.refused" && message.operationId) setQuestionChangeResult(message);
        if (message.type === "question.answer.result") {
          setAnswerResult(message);
          return;
        }
        if (message.type === "room.refused" && message.operationId) setAnswerResult(message);
        if (message.type === "question.accepted" || (message.type === "room.refused" && message.operationId)) {
          setQuestionResult(message);
          return;
        }
        if (message.type === "room.snapshot") {
          admitted = true;
          setStatus("live");
        }
        setState((previous) => applyLiveRoomMessage(previous, message));
      });
      current.addEventListener("close", (event) => {
        clearInterval(keepAlive);
        if (socket.current === current) socket.current = null;
        if (stopped) return;
        setStatus("offline");
        const refused = liveRoomRefusalFromClose(event.code, event.reason);
        if (refused) {
          setAdmissionRefusal(refused);
          return;
        }
        // A room that was never reached is not retried forever.
        if (!admitted && attempt >= RETRY_DELAYS_MS.length) return;
        retry = setTimeout(open, RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
        attempt += 1;
      });
    }

    setQuestionChangeResult(null);
    setQuestionResult(null);
    setAnswerResult(null);
    setStatus("connecting");
    setAdmissionRefusal(null);
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(keepAlive);
      socket.current?.close(1000, "Left the room");
      socket.current = null;
    };
  }, [slug, occurrenceId, enabled, overlayToken, output]);

  /** Sends one contract message; false when the room is not connected. */
  const send = useCallback((message: LiveRoomClientMessage): boolean => {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN) return false;
    current.send(JSON.stringify(liveRoomClientMessageSchema.parse(message)));
    return true;
  }, []);

  return { state, status, admissionRefusal, send, questionResult, answerResult, questionChangeResult };
}
