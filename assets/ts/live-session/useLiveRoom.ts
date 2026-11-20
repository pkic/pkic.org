import { useRef, useState } from "preact/hooks";
import {
  liveRoomSocketQuerySchema,
  type LiveOverlayView,
  type LiveRoomServerMessage,
} from "../../shared/schemas/live-session-room";

export type LivePresenceMessage = Extract<LiveRoomServerMessage, { type: "presence.changed" | "presence.left" }>;
import { applyLiveRoomMessage, type LiveRoomState } from "./live-room-state";
import type { LivePersistence } from "./live-socket-retry";
import { useLiveSocket, type LiveSocketFactory } from "./useLiveSocket";

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

/** A session's live room as `useLiveRoom` hands it out, for components that share one connection. */
export type LiveRoomConnection = ReturnType<typeof useLiveRoom>;

/** One session's live room over its socket, reconnecting with backoff while mounted and enabled. */
export function useLiveRoom({
  slug,
  occurrenceId,
  enabled = true,
  overlayToken,
  output,
  createSocket,
  onPresence,
  persistent,
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
  /** Never give up; the overlay access is read at each attempt, so renewing it does not reconnect. */
  persistent?: LivePersistence;
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
  const presence = useRef(onPresence);
  presence.current = onPresence;
  const connection = useLiveSocket<LiveRoomState>({
    url: () => liveRoomSocketUrl(window.location, slug, occurrenceId, output),
    urlKey: `${slug}/${occurrenceId}/${output ?? ""}`,
    enabled,
    snapshot: "room.snapshot",
    reduce: applyLiveRoomMessage,
    overlayToken,
    createSocket,
    persistent,
    onConnecting: () => {
      setQuestionChangeResult(null);
      setQuestionResult(null);
      setAnswerResult(null);
    },
    intercept: (message) => {
      if (message.type === "presence.changed" || message.type === "presence.left") {
        presence.current?.(message);
        return true;
      }
      if (message.type === "question.updated") {
        setQuestionChangeResult(message);
        return true;
      }
      if (message.type === "question.answer.result") {
        setAnswerResult(message);
        return true;
      }
      if (message.type === "question.accepted") {
        setQuestionResult(message);
        return true;
      }
      // A refused question, answer or edit answers its own request, and changes no state.
      if (message.type === "room.refused" && message.operationId) {
        setQuestionChangeResult(message);
        setAnswerResult(message);
        setQuestionResult(message);
        return true;
      }
      return false;
    },
  });
  return { ...connection, questionResult, answerResult, questionChangeResult };
}
