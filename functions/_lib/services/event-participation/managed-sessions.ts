import {
  scannerTargetQuerySchema,
  scannerTargetsResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { publishedSessionsSql } from "./published-schedule";
import { scannerTargetCatalog, scannerTargetFilter } from "./scanner-target-catalog";
export async function managedSessions(db: DatabaseLike, eventId: string, userId: string, raw: unknown) {
  const query = scannerTargetQuerySchema.parse(raw);
  const catalog = await scannerTargetCatalog(db, eventId);
  const { where, bindings: filters, order } = scannerTargetFilter(eventId, query, catalog);
  const bindings = [userId, ...filters];
  const from = `FROM (${publishedSessionsSql}) s JOIN agenda_session_delegations delegation ON delegation.occurrence_id=s.id AND delegation.user_id=? AND delegation.revoked_at IS NULL JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=s.id AND speaker.user_id=delegation.user_id`;
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${from} WHERE ${where}`, bindings);
  const sessions = await all(
    db,
    `SELECT s.id,s.title,s.start_at AS startAt,s.end_at AS endAt ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return scannerTargetsResponseSchema.parse({
    ...catalog,
    sessions,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
  });
}
