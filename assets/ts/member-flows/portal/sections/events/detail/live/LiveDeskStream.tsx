import { virtualRoomResponseSchema, locationStreamOn } from "../../../../../../../shared/schemas/event-live-stream";
import { instantToCalendarDate } from "../../../../../../../shared/timezone";
import { getJson } from "../../../../../../shared/api-client";
import { useEffect } from "preact/hooks";
import { useData } from "../../../../../../hooks/useData";
import { Spinner } from "../../../../../../components/Spinner";
import { StudioLivestreamMonitor } from "./studio/StudioLivestreamMonitor";

/** How long the monitor waits before it asks for the room's stream again after a failed read. */
export const LIVE_DESK_STREAM_RETRY_MS = 15_000;

/**
 * Only the authenticated attendee/staff stream projection supplies the player
 * destination. A monitor stays open through a whole session, so a read that
 * fails, such as a passing storage outage, is tried again on its own rather
 * than leaving the monitor on an error until someone reloads the studio.
 */
export function LiveDeskStream({ slug, roomId, startAt }: { slug: string; roomId: string; startAt: string }) {
  const streams = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda/streams`, virtualRoomResponseSchema),
    [slug],
  );
  const { error, reload } = streams;
  useEffect(() => {
    if (!error) return;
    const retry = setTimeout(() => void reload(), LIVE_DESK_STREAM_RETRY_MS);
    return () => clearTimeout(retry);
  }, [error, reload]);
  if (streams.loading) return <Spinner label="Loading this room's stream…" />;
  // While the stream cannot be read, the monitor says so in its own picture and keeps trying.
  if (error && !streams.data) return <p class="pk-studio-monitor__idle">Livestream not reachable. Trying again…</p>;
  const room = streams.data?.locations.find((entry) => entry.id === roomId);
  const stream =
    room && streams.data ? locationStreamOn(room, instantToCalendarDate(startAt, streams.data.timeZone)) : null;
  // No stream is an ordinary state of a monitor: the monitor's own empty picture, not the player's card.
  if (!stream) return <p class="pk-studio-monitor__idle">No livestream for this room</p>;
  return (
    <StudioLivestreamMonitor key={stream.videoId} videoId={stream.videoId} roomName={room?.name ?? "Selected room"} />
  );
}
