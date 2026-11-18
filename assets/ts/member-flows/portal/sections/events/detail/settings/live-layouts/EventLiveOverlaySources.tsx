import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import { personalAgendaProgramResponseSchema } from "../../../../../../../../shared/schemas/event-personal-agenda";
import { ErrorAlert } from "../../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../../components/Spinner";
import { useData } from "../../../../../../../hooks/useData";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import { getJson } from "../../../../../../../shared/api-client";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import { Field } from "../../../../../../../ui/Field";
import { Select } from "../../../../../../../ui/TextControl";
import { LiveOverlayLinks } from "../../live/LiveOverlayLinks";

/**
 * A room's screens and the links that show them. Each screen sets its own
 * scene. Source access belongs to the physical room, independent of the
 * session it has on air.
 */
export function EventLiveOverlaySources({
  slug,
  layouts,
}: {
  slug: string;
  layouts: ReadonlyArray<{ slug: string; name: string }>;
}) {
  const [roomQuery, setRoomQuery] = useHashQueryParam("room", "");
  const scenes = liveOverlayLayoutChoices(layouts);
  const program = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation/program`,
        personalAgendaProgramResponseSchema,
      ),
    [slug],
  );
  const rooms = program.data?.agenda?.rooms ?? [];
  const roomId = rooms.find((room) => room.id === roomQuery)?.id ?? rooms[0]?.id;
  if (program.error) return <ErrorAlert error={program.error} />;
  if (!program.data) return <Spinner label="Loading rooms…" />;
  if (!roomId)
    return (
      <EmptyState title="No published rooms" body="Publish the agenda with rooms before creating browser sources." />
    );
  return (
    <div class="pk-stack">
      <Field label="Room">
        {(control) => (
          <Select
            {...control}
            name="roomId"
            value={roomId}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (rooms.some((room) => room.id === next)) setRoomQuery(next);
            }}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <LiveOverlayLinks key={roomId} slug={slug} roomId={roomId} scenes={scenes} />
    </div>
  );
}
