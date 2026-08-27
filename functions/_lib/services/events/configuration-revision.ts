import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLogAfterOneChange, type AuditScope } from "../audit";

export interface EventConfigurationMutationContext {
  actorId: string;
  auditScope: AuditScope;
  expectedUpdatedAt: string;
  authorizationGuards?: StatementLike[];
}

/**
 * Makes a child-configuration replacement part of the event's optimistic
 * revision. The audit statement immediately following the compare-and-set
 * turns a stale revision into a D1 batch failure, rolling child writes back.
 */
export function prepareEventConfigurationRevision(
  db: DatabaseLike,
  eventId: string,
  context: EventConfigurationMutationContext,
  action: string,
  details: unknown,
): { updatedAt: string; statements: StatementLike[] } {
  const updatedAt = nowIso();
  return {
    updatedAt,
    statements: [
      db
        .prepare("UPDATE events SET updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(updatedAt, eventId, context.expectedUpdatedAt),
      prepareScopedAuditLogAfterOneChange(
        db,
        context.auditScope,
        "admin",
        context.actorId,
        action,
        "event",
        eventId,
        details,
        updatedAt,
      ),
    ],
  };
}
