import { guardAuthorizedDatabase } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
export function participantSessionDatabase(db: DatabaseLike, userId: string, sessionId: string): DatabaseLike {
  return guardAuthorizedDatabase(
    db,
    {
      sql: "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND u.active=1",
      bindings: [sessionId, userId],
    },
    () => new Error("AUTHORIZATION_CONTEXT_CHANGED"),
  );
}
