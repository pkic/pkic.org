import { run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { stringifyJson } from "../utils/json";
import type { DatabaseLike, StatementLike } from "../types";

interface AuditDeltaLike {
  from: unknown;
  to: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuditDeltaLike(value: unknown): value is AuditDeltaLike {
  return isRecord(value) && "from" in value && "to" in value;
}

function normalizeAuditDetails(details: unknown): unknown {
  if (!isRecord(details)) return details;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    normalized[key] = isAuditDeltaLike(value) ? value : { from: null, to: value };
  }

  return normalized;
}

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
    [uuid(), actorType, actorId, action, entityType, entityId, stringifyJson(normalizeAuditDetails(details)), nowIso()],
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
    .bind(
      uuid(),
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      stringifyJson(normalizeAuditDetails(details)),
      nowIso(),
    );
}
