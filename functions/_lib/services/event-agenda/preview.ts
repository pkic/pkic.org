import { storedAgendaSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-stored";
import { agendaSnapshotSchema, type AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { projectLiveAgendaMaterials } from "../site-agenda-material-eligibility";
import { getAgenda } from "./read";
import { preparePublicAgendaSnapshot } from "./public-snapshot";
import { publicAgendaProjection } from "./public-projection";

/** Read-only: public rendering never activates or approves the draft being reviewed. */
export async function previewAgenda(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: "draft" | "approved",
): Promise<AgendaSnapshot> {
  const event = await first<{ base_path: string | null }>(db, "SELECT base_path FROM events WHERE id=?", [eventId]);
  let snapshot: AgendaSnapshot;
  if (revision === "approved") {
    const frozen = await first<{ snapshot_json: string }>(
      db,
      "SELECT publication.snapshot_json FROM event_agenda_publications publication JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision WHERE publication.event_id=?",
      [eventId],
    );
    if (!frozen)
      throw new AppError(404, "AGENDA_APPROVED_REVISION_NOT_FOUND", "No agenda revision has been approved yet");
    snapshot = storedAgendaSnapshotSchema.parse(JSON.parse(frozen.snapshot_json));
  } else {
    const draft = await getAgenda(db, eventId, eventSlug);
    snapshot = { ...preparePublicAgendaSnapshot(draft, draft.revision), publishedRevision: draft.publishedRevision };
  }
  return agendaSnapshotSchema.parse(
    publicAgendaProjection(await projectLiveAgendaMaterials(db, eventId, snapshot), event?.base_path ?? null),
  );
}
