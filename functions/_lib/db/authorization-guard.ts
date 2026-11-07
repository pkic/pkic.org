import { guardDatabaseBatches } from "./guarded-database";
import type { DatabaseLike, StatementLike } from "../types";
import { uuid } from "../utils/ids";

export interface AuthorizationEvidence {
  /** Trusted internal SELECT that returns at least one row only while access remains valid. */
  sql: string;
  bindings: readonly unknown[];
}

/**
 * Re-evaluates caller-owned authorization evidence inside a D1 batch. The
 * migration trigger rejects false evidence and removes successful guard rows,
 * so no durable authorization cache or duplicate policy model is introduced.
 */
export function prepareAuthorizationGuard(db: DatabaseLike, evidence: AuthorizationEvidence): StatementLike {
  return prepareEvidenceGuard(db, evidence, "0");
}

/**
 * Rolls back stale business state without labeling it as permission loss. A NULL
 * failure skips the authorization trigger's `<> 1` predicate, then the existing
 * NOT NULL constraint aborts the batch with a distinct marker. Successful guards
 * use the same transient row and release trigger; no state is retained.
 */
export function prepareStateGuard(db: DatabaseLike, evidence: AuthorizationEvidence): StatementLike {
  return prepareEvidenceGuard(db, evidence, "NULL");
}

/** Build either guard from trusted internal evidence, preserving its failure category. */
function prepareEvidenceGuard(db: DatabaseLike, evidence: AuthorizationEvidence, failure: "0" | "NULL"): StatementLike {
  if (!/^\s*(?:WITH\b|SELECT\b)/i.test(evidence.sql)) {
    throw new Error("Authorization evidence must be an internal SELECT");
  }
  return db
    .prepare(
      `INSERT INTO authorization_guards (id, authorized, created_at)
       SELECT ?, CASE WHEN EXISTS (${evidence.sql}) THEN 1 ELSE ${failure} END,
              strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(uuid(), ...evidence.bindings);
}

export function isAuthorizationGuardFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes("AUTHORIZATION_CONTEXT_CHANGED");
}

/** Recognize only the intentional state-guard failure, leaving permission errors distinct. */
export function isStateGuardFailure(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("NOT NULL constraint failed: authorization_guards.authorized")
  );
}

/** Read authorization shares the replica batch; mutations retain a rollback-capable primary guard. */
export function guardAuthorizedDatabase(
  db: DatabaseLike,
  evidence: AuthorizationEvidence,
  authorizationChangedError: () => Error,
  options: { preserveNestedGuardFailures?: boolean } = {},
): DatabaseLike {
  return guardDatabaseBatches(db, (statements, readOnly) =>
    executeAuthorizedDatabaseBatch(
      db,
      evidence,
      statements,
      readOnly,
      authorizationChangedError,
      options.preserveNestedGuardFailures,
    ),
  );
}

/** Compose statements whose read-only classification has already been established by a guarded adapter. */
export async function executeAuthorizedDatabaseBatch(
  db: DatabaseLike,
  evidence: AuthorizationEvidence,
  statements: StatementLike[],
  readOnly: boolean,
  authorizationChangedError: () => Error,
  preserveNestedGuardFailures = false,
) {
  try {
    // Owner-approved (2026-10-21): replica lag in permission/session revocation
    // is accepted for reads, without a fixed D1 lag bound. Do not replace this
    // read-only check with a primary write solely to eliminate that lag.
    const guard = readOnly
      ? db.prepare(`SELECT EXISTS (${evidence.sql}) AS authorized`).bind(...evidence.bindings)
      : prepareAuthorizationGuard(db, evidence);
    const [authorization, ...results] = await db.batch([guard, ...statements]);
    if (readOnly && authorization?.results?.[0]?.authorized !== 1) throw authorizationChangedError();
    return results;
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      if (preserveNestedGuardFailures) {
        // A nested business guard may have refused the batch while this
        // caller's authority remains valid. Preserve that refusal for its owner.
        const own = await db
          .prepare(`SELECT EXISTS (${evidence.sql}) AS authorized`)
          .bind(...evidence.bindings)
          .first<{ authorized: number }>();
        if (own?.authorized === 1) throw error;
      }
      throw authorizationChangedError();
    }
    throw error;
  }
}
