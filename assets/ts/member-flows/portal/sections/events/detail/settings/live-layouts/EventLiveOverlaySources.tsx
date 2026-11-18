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

/** A link that names no scene draws whichever scene its output has on air. */
const ON_AIR = "";

/**
 * A room's browser sources, following the scene on air or fixed to one.
 * Source access belongs to the physical room, independent of the session
 * it has on air.
 */
export function EventLiveOverlaySources({
  slug,
  layouts,
}: {
  slug: string;
  layouts: ReadonlyArray<{ slug: string; name: string }>;
}) {
  const [roomQuery, setRoomQuery] = useHashQueryParam("room", "");
  const [sceneQuery, setSceneQuery] = useHashQueryParam("source-scene", ON_AIR);
  const scene = layouts.find((layout) => layout.slug === sceneQuery) ?? null;
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
      <Field label="Scene">
        {(control) => (
          <Select
            {...control}
            name="scene"
            value={scene?.slug ?? ON_AIR}
            onChange={(event) => setSceneQuery(event.currentTarget.value)}
          >
            <option value={ON_AIR}>The scene on air</option>
            {layouts.map((layout) => (
              <option key={layout.slug} value={layout.slug}>
                Always {layout.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <LiveOverlayLinks key={roomId} slug={slug} roomId={roomId} layout={scene?.slug ?? null} />
    </div>
  );
}
