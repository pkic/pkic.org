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
  if (!/^\s*(?:WITH\b|SELECT\b)/i.test(evidence.sql)) {
    throw new Error("Authorization evidence must be an internal SELECT");
  }
  return db
    .prepare(
      `INSERT INTO authorization_guards (id, authorized, created_at)
       SELECT ?, CASE WHEN EXISTS (${evidence.sql}) THEN 1 ELSE 0 END,
              strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(uuid(), ...evidence.bindings);
}

export function isAuthorizationGuardFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes("AUTHORIZATION_CONTEXT_CHANGED");
}
