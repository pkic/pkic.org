import { virtualRoomResponseSchema, locationStreamOn } from "../../../../../../../shared/schemas/event-live-stream";
import { instantToCalendarDate } from "../../../../../../../shared/timezone";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { VirtualRoomPlayer } from "../../app/virtual-room/VirtualRoomPlayer";

/** Only the authenticated attendee/staff stream projection supplies the player destination. */
export function LiveDeskStream({ slug, roomId, startAt }: { slug: string; roomId: string; startAt: string }) {
  const streams = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda/streams`, virtualRoomResponseSchema),
    [slug],
  );
  if (streams.loading) return <Spinner label="Loading this room's stream…" />;
  if (streams.error) return <ErrorAlert error={streams.error} />;
  const room = streams.data?.locations.find((entry) => entry.id === roomId);
  const stream =
    room && streams.data ? locationStreamOn(room, instantToCalendarDate(startAt, streams.data.timeZone)) : null;
  // No stream is an ordinary state of a monitor: the monitor's own empty picture, not the player's card.
  if (!stream) return <p class="pk-studio-monitor__idle">No livestream for this room</p>;
  return <VirtualRoomPlayer stream={stream} locationName={room?.name ?? "Selected room"} presentation="monitor" />;
}
