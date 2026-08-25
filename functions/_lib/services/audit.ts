import { run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import type { DatabaseLike, StatementLike } from "../types";

interface AuditDeltaLike {
  from: unknown;
  to: unknown;
}

export interface AuditScope {
  type: string;
  id: string;
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
  scope: AuditScope | null = null,
): Promise<void> {
  await run(
    db,
    `INSERT INTO audit_log (
      id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      serializeAuditDetails(details),
      nowIso(),
      scope?.type ?? null,
      scope?.id ?? null,
    ],
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
  scope: AuditScope | null = null,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO audit_log (
      id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at,
      idempotency_key, scope_type, scope_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      scope?.type ?? null,
      scope?.id ?? null,
    );
}

/** Explicit scoped variant for child-entity audit rows owned by an aggregate. */
export function prepareScopedAuditLog(
  db: DatabaseLike,
  scope: AuditScope,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
  createdAt = nowIso(),
  idempotencyKey: string | null = null,
): StatementLike {
  return prepareAuditLog(
    db,
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    details,
    createdAt,
    idempotencyKey,
    scope,
  );
}

/**
 * Builds an audit INSERT that also turns a lost compare-and-set into a real
 * SQL failure. `audit_log.action` is NOT NULL, so a preceding statement that
 * changed anything other than the caller's bounded expected count aborts the
 * surrounding D1 batch and
 * rolls every statement back instead of allowing partial fallout to commit.
 * Keep this immediately after the guarded write because SQLite's `changes()`
 * reports the most recently executed statement.
 */
export function prepareAuditLogAfterExpectedChanges(
  db: DatabaseLike,
  expectedChanges: number,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
  createdAt = nowIso(),
  scope: AuditScope | null = null,
  idempotencyKey: string | null = null,
): StatementLike {
  if (!Number.isSafeInteger(expectedChanges) || expectedChanges < 1) {
    throw new Error("Expected change count must be a positive safe integer");
  }
  return db
    .prepare(
      `INSERT INTO audit_log (
        id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at,
        idempotency_key, scope_type, scope_id
      ) VALUES (?, ?, ?, CASE WHEN changes() = ? THEN ? ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    )
    .bind(
      uuid(),
      actorType,
      actorId,
      expectedChanges,
      action,
      entityType,
      entityId,
      serializeAuditDetails(details),
      createdAt,
      idempotencyKey,
      scope?.type ?? null,
      scope?.id ?? null,
    );
}

export function prepareAuditLogAfterOneChange(
  db: DatabaseLike,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
  createdAt = nowIso(),
  scope: AuditScope | null = null,
  idempotencyKey: string | null = null,
): StatementLike {
  return prepareAuditLogAfterExpectedChanges(
    db,
    1,
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    details,
    createdAt,
    scope,
    idempotencyKey,
  );
}

/** Scoped compare-and-set audit variant; preserves the same `changes()` guard. */
export function prepareScopedAuditLogAfterOneChange(
  db: DatabaseLike,
  scope: AuditScope,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
  createdAt = nowIso(),
  idempotencyKey: string | null = null,
): StatementLike {
  return prepareAuditLogAfterOneChange(
    db,
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    details,
    createdAt,
    scope,
    idempotencyKey,
  );
}

/** Scoped compare-and-set audit for a bounded multi-row state transition. */
export function prepareScopedAuditLogAfterExpectedChanges(
  db: DatabaseLike,
  expectedChanges: number,
  scope: AuditScope,
  actorType: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: unknown,
  createdAt = nowIso(),
  idempotencyKey: string | null = null,
): StatementLike {
  return prepareAuditLogAfterExpectedChanges(
    db,
    expectedChanges,
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    details,
    createdAt,
    scope,
    idempotencyKey,
  );
}

const AUDIT_CHANGE_GUARD_ERROR = "NOT NULL constraint failed: audit_log.action";

/**
 * Classifies the deliberate constraint failure emitted by
 * `prepareAuditLogAfterOneChange`. Keep the D1/SQLite error-text coupling in
 * this module rather than duplicating it across every guarded command.
 */
export function isAuditChangeGuardFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes(AUDIT_CHANGE_GUARD_ERROR);
}

/** Backward-compatible classifier name for existing one-row callers. */
export function isAuditOneChangeGuardFailure(error: unknown): boolean {
  return isAuditChangeGuardFailure(error);
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
    scope?: AuditScope | null;
  },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO audit_log (
         id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at,
         scope_type, scope_id
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      input.scope?.type ?? null,
      input.scope?.id ?? null,
      ...input.conditionBindings,
    );
}
