/**
 * The acting identity behind a request's audit records.
 *
 * Audit rows are written from hundreds of use cases that receive an actor id,
 * not the session that produced it. The request owns one scope for the whole
 * of its asynchronous work; session resolution records which identity the
 * signed-in person is acting as, and every audit insert reads it back when the
 * row's actor is that same person. Work outside a request (scheduled jobs,
 * inbound email, queue consumers) has no scope and records no acting identity.
 *
 * The scope object is created per request by `runWithAuditActorScope`, so the
 * module-level storage holds no request state of its own.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { USER_BACKED_AUDIT_ACTOR_TYPES } from "../../../assets/shared/schemas/audit-log";

interface AuditActorScope {
  userId: string | null;
  identityId: string | null;
}

const auditActorScope = new AsyncLocalStorage<AuditActorScope>();

/** Runs one request's work inside its own audit actor scope. */
export function runWithAuditActorScope<T>(work: () => Promise<T>): Promise<T> {
  return auditActorScope.run({ userId: null, identityId: null }, work);
}

/** Records the person a session authenticates and the identity it acts as (null until one is chosen). */
export function recordAuditActingIdentity(userId: string, identityId: string | null): void {
  const scope = auditActorScope.getStore();
  if (!scope) return;
  scope.userId = userId;
  scope.identityId = identityId;
}

/** The acting identity to store on an audit row whose actor is the signed-in person; otherwise null. */
export function auditActorIdentityId(actorType: string, actorId: string | null): string | null {
  const scope = auditActorScope.getStore();
  if (!scope || !actorId || scope.userId !== actorId) return null;
  return (USER_BACKED_AUDIT_ACTOR_TYPES as readonly string[]).includes(actorType) ? scope.identityId : null;
}
