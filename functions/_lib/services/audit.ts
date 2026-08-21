import { run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import type { DatabaseLike, StatementLike } from "../types";

interface AuditDeltaLike {
  from: unknown;
  to: unknown;
}

export interface AuditLogReadRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details_json: string | null;
  created_at: string;
}

export function toAuditLogResponseRows(rows: AuditLogReadRow[]) {
  return rows.map(({ details_json, ...row }) => ({
    ...row,
    details: details_json ? parseJsonSafe<unknown>(details_json, null) : null,
  }));
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

export function serializeAuditDetails(details: unknown): string {
  return stringifyJson(normalizeAuditDetails(details));
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
    [uuid(), actorType, actorId, action, entityType, entityId, serializeAuditDetails(details), nowIso()],
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
  createdAt = nowIso(),
  idempotencyKey: string | null = null,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO audit_log (
      id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    )
    .bind(
      uuid(),
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      serializeAuditDetails(details),
      createdAt,
      idempotencyKey,
    );
}

/**
 * Builds an audit INSERT that also turns a lost compare-and-set into a real
 * SQL failure. `audit_log.action` is NOT NULL, so a preceding statement that
 * changed anything other than one row aborts the surrounding D1 batch and
 * rolls every statement back instead of allowing partial fallout to commit.
 * Keep this immediately after the guarded write because SQLite's `changes()`
 * reports the most recently executed statement.
 */
export function prepareAuditLogAfterOneChange(
  db: DatabaseLike,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
  createdAt = nowIso(),
): StatementLike {
  return db
    .prepare(
      `INSERT INTO audit_log (
        id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at
      ) VALUES (?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?, ?, ?, ?)`,
    )
    .bind(uuid(), actorType, actorId, action, entityType, entityId, serializeAuditDetails(details), createdAt);
}

/**
 * Builds an audit INSERT guarded by a static caller-owned EXISTS predicate.
 * This lets compare-and-set command batches avoid recording a losing write.
 * The SQL fragment must be a fixed internal string; values remain bound.
 */
export function prepareAuditLogWhen(
  db: DatabaseLike,
  input: {
    actorType: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    details: unknown;
    conditionSql: string;
    conditionBindings: unknown[];
    createdAt?: string;
  },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO audit_log (
         id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (${input.conditionSql})`,
    )
    .bind(
      uuid(),
      input.actorType,
      input.actorId,
      input.action,
      input.entityType,
      input.entityId,
      serializeAuditDetails(input.details),
      input.createdAt ?? nowIso(),
      ...input.conditionBindings,
    );
}
