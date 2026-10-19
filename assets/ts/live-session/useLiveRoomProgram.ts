import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  LIVE_PROGRAM_PROTOCOL,
  liveProgramMessageSchema,
  liveProgramSelectionSchema,
  type LiveProgramSelection,
} from "../../shared/schemas/live-room-program";
import { LIVE_OVERLAY_PROTOCOL_PREFIX, liveRoomRefusalFromClose } from "../../shared/schemas/live-session-room";
import { getJson, postJson } from "../shared/api-client";
import { liveRoomOpenFailure } from "./live-room-copy";
import type { LiveSocketFactory } from "./useLiveRoom";
const socketFactory: LiveSocketFactory = (url, protocols) => new WebSocket(url, protocols);
export function liveProgramPath(slug: string, roomId: string) {
  return `/api/v1/events/${encodeURIComponent(slug)}/agenda/rooms/${encodeURIComponent(roomId)}/live/program`;
}
/** One physical room's selection; the selected session keeps all authoritative live content. */
export function useLiveRoomProgram({
  slug,
  roomId,
  overlayToken,
  createSocket = socketFactory,
}: {
  slug: string;
  roomId: string;
  overlayToken?: string;
  createSocket?: LiveSocketFactory;
}) {
  const [selection, setSelection] = useState<LiveProgramSelection | null>(null),
    [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting"),
    [error, setError] = useState<Error | null>(null);
  const factory = useRef(createSocket);
  factory.current = createSocket;
  useEffect(() => {
    let stopped = false,
      retry: ReturnType<typeof setTimeout> | undefined,
      ping: ReturnType<typeof setInterval> | undefined,
      socket: WebSocket | null = null,
      attempts = 0;
    setSelection(null);
    setStatus("connecting");
    setError(null);
    function open() {
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      let current: WebSocket;
      try {
        current = factory.current(`${scheme}//${window.location.host}${liveProgramPath(slug, roomId)}`, [
          LIVE_PROGRAM_PROTOCOL,
          ...(overlayToken ? [LIVE_OVERLAY_PROTOCOL_PREFIX + overlayToken] : []),
        ]);
      } catch {
        setStatus("offline");
        setError(new Error(liveRoomOpenFailure(null, "operator")));
        return;
      }
      socket = current;
      current.addEventListener("open", () => {
        attempts = 0;
        ping = setInterval(() => current.send("ping"), 25000);
      });
      current.addEventListener("message", (event) => {
        if (stopped || socket !== current || event.data === "pong") return;
        try {
          const parsed = liveProgramMessageSchema.safeParse(JSON.parse(String(event.data)));
          if (parsed.success && parsed.data.selection.roomId === roomId) {
            setSelection((previous) =>
              previous && previous.revision > parsed.data.selection.revision ? previous : parsed.data.selection,
            );
            setStatus("live");
            setError(null);
          }
        } catch {
          /* A malformed frame grants no state. */
        }
      });
      current.addEventListener("error", () => {
        if (stopped || socket !== current) return;
        setStatus("offline");
        setError(new Error(liveRoomOpenFailure(null, "operator")));
      });
      current.addEventListener("close", (event) => {
        clearInterval(ping);
        if (stopped || socket !== current) return;
        setStatus("offline");
        const refused = liveRoomRefusalFromClose(event.code, event.reason);
        if (refused) {
          setSelection(null);
          setError(new Error(liveRoomOpenFailure(refused, "operator")));
          return;
        }
        retry = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)));
      });
    }
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket?.close(1000, "Left the physical room program");
    };
  }, [slug, roomId, overlayToken]);
  const select = useCallback(
    async (occurrenceId: string | null) => {
      const current = selection ?? (await getJson(liveProgramPath(slug, roomId), liveProgramSelectionSchema));
      const selected = await postJson(
        liveProgramPath(slug, roomId),
        { occurrenceId, expectedRevision: current.revision },
        liveProgramSelectionSchema,
      );
      setSelection(selected);
    },
    [slug, roomId, selection],
  );
  return { selection, status, error, select };
}
