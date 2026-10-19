import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";

/** One owning-event approved pointer read shared by graphic refresh; no draft read or payload identity guess. */
export async function readPublishedLiveAgenda(db: DatabaseLike, eventId: string): Promise<AgendaSnapshot | null> {
  const row = await first<{ event_id: string; snapshot_json: string }>(
    db,
    `SELECT publication.event_id,publication.snapshot_json FROM event_agenda_publications publication
     JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision
     WHERE publication.event_id=?`,
    [eventId],
  );
  if (!row || row.event_id !== eventId) return null;
  const parsed = storedAgendaSnapshotSchema.safeParse(parseJsonSafe<unknown>(row.snapshot_json, null));
  return parsed.success ? parsed.data : null;
}
