import type { DatabaseLike, Env } from "../../types";
import { batchRows } from "../../db/pagination";
import { readSessionParticipantResource } from "./management-authorization";

/** Read management-only speakers with the exact session's live authorization snapshot. */
export async function readSessionManagementInfoRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
) {
  return readSessionParticipantResource(db, request, env, slug, occurrenceId, () => ({
    statements: [
      db
        .prepare(
          "SELECT speaker.user_id AS userId,COALESCE(NULLIF(person.preferred_name,''),NULLIF(TRIM(COALESCE(person.first_name,'')||' '||COALESCE(person.last_name,'')),''),'Speaker') AS displayName FROM event_agenda_occurrence_speakers speaker JOIN users person ON person.id=speaker.user_id WHERE speaker.occurrence_id=? LIMIT 30",
        )
        .bind(occurrenceId),
    ],
    decode: (loaded, { canDelegate }) => ({ canDelegate, speakers: batchRows(loaded[0]) }),
  }));
}
