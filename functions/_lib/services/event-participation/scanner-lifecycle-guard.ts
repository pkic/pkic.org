import type { DatabaseLike } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";

/** Domain CAS evidence stays distinct from the surrounding live permission guard. */
export function prepareScannerLifecycleGuard(db: DatabaseLike, evidence: AuthorizationEvidence) {
  const id = crypto.randomUUID();
  return {
    statement: db
      .prepare(
        `INSERT INTO event_scanner_upload_guards(id,valid) SELECT ?,CASE WHEN EXISTS(${evidence.sql}) THEN 1 ELSE 0 END`,
      )
      .bind(id, ...evidence.bindings),
    cleanup: db.prepare("DELETE FROM event_scanner_upload_guards WHERE id=?").bind(id),
  };
}
export function isScannerLifecycleGuardFailure(error: unknown) {
  return error instanceof Error && error.message.includes("scanner_upload_epoch_valid");
}
