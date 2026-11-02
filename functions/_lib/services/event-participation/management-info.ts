import type { DatabaseLike, Env } from "../../types";
import { batchRows } from "../../db/pagination";
import { eventReadIdSql } from "../events/selection";
import { readSessionParticipantResource } from "./management-authorization";
import { personDisplayNameSql } from "../people/person-name-sql";

/** Read management-only speakers with the exact session's live authorization snapshot. */
export async function readSessionManagementInfoRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
  occurrenceId: string,
) {
  return readSessionParticipantResource(db, request, env, slug, occurrenceId, (event) => {
    const scope = eventReadIdSql(event);
    return {
      statements: [
        db
          .prepare(
            `SELECT speaker.user_id AS userId,${personDisplayNameSql("person", "Speaker")} AS displayName FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id JOIN users person ON person.id=speaker.user_id WHERE speaker.occurrence_id=? AND occurrence.event_id=${scope.sql} ORDER BY speaker.user_id LIMIT 30`,
          )
          .bind(occurrenceId, ...scope.bindings),
      ],
      decode: (loaded, { canDelegate }) => ({ canDelegate, speakers: batchRows(loaded[0]) }),
    };
  });
}
