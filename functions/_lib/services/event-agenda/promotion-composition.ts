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
