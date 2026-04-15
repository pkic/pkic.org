import { run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { stringifyJson } from "../utils/json";
import type { DatabaseLike, StatementLike } from "../types";

export async function writeAuditLog(
  db: DatabaseLike,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
): Promise<void> {
  await run(
    db,
    `INSERT INTO audit_log (
      id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), actorType, actorId, action, entityType, entityId, stringifyJson(details), nowIso()],
  );
}

/**
 * Returns a prepared statement for use in `db.batch()` calls.
 */
export function prepareAuditLog(
  db: DatabaseLike,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO audit_log (
      id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(uuid(), actorType, actorId, action, entityType, entityId, stringifyJson(details), nowIso());
}
