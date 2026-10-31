import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { batchFirst } from "../../db/pagination";
import type { D1StatementResult } from "../../types";
import {
  promotionCompositionSchema,
  defaultPromotionComposition,
} from "../../../../assets/shared/schemas/event-promotion-design";
import type { DatabaseLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
export async function promotionKitId(eventId: string, userId: string, occurrenceId: string | null) {
  return sha256Hex(JSON.stringify([eventId, userId, occurrenceId]));
}
export function preparePromotionComposition(
  db: DatabaseLike,
  event: EventReadSelection,
  userId: string,
  occurrenceId: string | null,
) {
  const scope = eventReadIdSql(event);
  return {
    statements: [
      db
        .prepare(
          `SELECT id,revision,composition_json FROM event_promotion_kits WHERE event_id=${scope.sql} AND user_id=? AND occurrence_id IS ? LIMIT 1`,
        )
        .bind(...scope.bindings, userId, occurrenceId),
    ],
    async decode(loaded: D1StatementResult[], eventId: string) {
      const row = batchFirst<{ id: string; revision: number; composition_json: string }>(loaded[0]);
      return {
        id: row?.id ?? (await promotionKitId(eventId, userId, occurrenceId)),
        revision: row?.revision ?? 0,
        composition: row
          ? promotionCompositionSchema.parse(JSON.parse(row.composition_json))
          : defaultPromotionComposition(occurrenceId === null),
      };
    },
  };
}

/** Public session picks share the same publication predicate for saves and render requests. */
export function promotionSessionPicksEvidence(
  event: EventReadSelection,
  requested: { sql: string; bindings: readonly unknown[] },
) {
  const scope = eventReadIdSql(event);
  return {
    sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each((${requested.sql})) requested WHERE NOT EXISTS(SELECT 1 FROM event_agenda_publications publication JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision,json_each(publication.snapshot_json,'$.occurrences') entry WHERE publication.event_id=${scope.sql} AND json_extract(entry.value,'$.id')=requested.value AND json_extract(entry.value,'$.visibility')='public' AND json_extract(entry.value,'$.kind')<>'break'))`,
    bindings: [...requested.bindings, ...scope.bindings],
  };
}
