import {
  badgeIssueResponseSchema,
  type BadgeIssueRequest,
  type BadgeIssueResponse,
} from "../../../../assets/shared/schemas/route-contracts-event-badges";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareOneTimeAuditLog, prepareScopedAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
import { hashBadgeCredential } from "./badge-hash";
import { resolveBadgeExpiry } from "./badge-expiry";

type OwnedBadge = {
  id: string;
  user_id: string;
  credential_hash: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};
async function ownedBadge(db: DatabaseLike, eventId: string, id: string): Promise<OwnedBadge> {
  const row = await first<OwnedBadge>(
    db,
    "SELECT id,user_id,credential_hash,created_at,expires_at,revoked_at FROM event_badge_credentials WHERE event_id=? AND id=?",
    [eventId, id],
  );
  if (!row) throw new AppError(404, "BADGE_NOT_FOUND", "Badge unavailable.");
  return row;
}
function prepareRevocation(db: DatabaseLike, eventId: string, badge: OwnedBadge, now: string) {
  return db
    .prepare(
      "UPDATE event_badge_credentials SET revoked_at=? WHERE id=? AND event_id=? AND user_id=? AND credential_hash=? AND created_at=? AND expires_at IS ? AND revoked_at IS NULL",
    )
    .bind(now, badge.id, eventId, badge.user_id, badge.credential_hash, badge.created_at, badge.expires_at);
}
const receiptKey = (eventId: string, operationId: string) => `badge-issuance:${eventId}:${operationId}`;
function throwBadgeCommandError(error: unknown): never {
  if (isAuditChangeGuardFailure(error))
    throw new AppError(409, "BADGE_CHANGED", "The badge or event registration changed. Refresh before continuing.");
  if (error instanceof Error && error.message.includes("EVENT_EVIDENCE_CAPTURE_CLOSED"))
    throw new AppError(409, "BADGE_CAPTURE_CLOSED", "Badge changes are closed for this event.");
  throw error;
}

async function completedIssue(
  db: DatabaseLike,
  eventId: string,
  actorId: string,
  input: BadgeIssueRequest,
  digest: string,
): Promise<BadgeIssueResponse | null> {
  const receipt = await first<{
    actor_id: string;
    entity_id: string;
    request_digest: string;
  }>(
    db,
    "SELECT actor_id,entity_id,json_extract(details_json,'$.requestDigest.to') AS request_digest FROM audit_log WHERE idempotency_key=? AND scope_type='event' AND scope_id=? AND action='badge_issuance_completed'",
    [receiptKey(eventId, input.operationId), eventId],
  );
  if (!receipt) return null;
  if (receipt.actor_id !== actorId || receipt.request_digest !== digest)
    throw new AppError(409, "BADGE_OPERATION_REUSED", "Use a new operation ID for a different badge action.");
  const badge = await ownedBadge(db, eventId, receipt.entity_id);
  if (badge.user_id !== input.userId)
    throw new AppError(409, "BADGE_CHANGED", "The badge owner changed. Refresh before continuing.");
  return badgeIssueResponseSchema.parse({
    result: "replayed",
    id: badge.id,
    credential: null,
    expiresAt: badge.expires_at,
    replacedBadgeId: input.replaceBadgeId ?? null,
  });
}

/** Caller supplies the live event-management database; every effect shares one guarded command. */
export async function issueBadge(
  db: DatabaseLike,
  eventId: string,
  actorId: string,
  input: BadgeIssueRequest,
): Promise<BadgeIssueResponse> {
  const requestDigest = await hashBadgeCredential(
    JSON.stringify({
      userId: input.userId,
      expiresAt: input.expiresAt ?? null,
      replaceBadgeId: input.replaceBadgeId ?? null,
    }),
  );
  const replay = await completedIssue(db, eventId, actorId, input, requestDigest);
  if (replay) return replay;
  const event = await first<{ ends_at: string | null }>(db, "SELECT ends_at FROM events WHERE id=?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  if (!(await first(db, "SELECT id FROM registrations WHERE event_id=? AND user_id=?", [eventId, input.userId])))
    throw new AppError(
      409,
      "BADGE_REGISTRATION_REQUIRED",
      "The attendee must have an event registration before a badge can be issued.",
    );
  const previous = input.replaceBadgeId ? await ownedBadge(db, eventId, input.replaceBadgeId) : null;
  if (previous && previous.user_id !== input.userId)
    throw new AppError(409, "BADGE_REPLACEMENT_OWNER_MISMATCH", "Choose a badge belonging to this attendee.");
  if (previous?.revoked_at) {
    const committed = await completedIssue(db, eventId, actorId, input, requestDigest);
    if (committed) return committed;
    throw new AppError(
      409,
      "BADGE_ALREADY_REVOKED",
      "This badge has already been revoked. Refresh before replacing it.",
    );
  }
  const now = nowIso(),
    expiresAt = resolveBadgeExpiry(now, event.ends_at, input.expiresAt),
    id = crypto.randomUUID(),
    credential = crypto.randomUUID();
  const scope = { type: "event", id: eventId };
  const statements = [
    prepareOneTimeAuditLog(
      db,
      "user",
      actorId,
      "badge_issuance_completed",
      "event_badge_credential",
      id,
      {
        userId: input.userId,
        replacedBadgeId: input.replaceBadgeId ?? null,
        requestDigest,
        expiresAt,
      },
      now,
      receiptKey(eventId, input.operationId),
      scope,
    ),
  ];
  if (previous)
    statements.push(
      prepareRevocation(db, eventId, previous, now),
      prepareScopedAuditLogAfterOneChange(
        db,
        scope,
        "user",
        actorId,
        "badge_replaced",
        "event_badge_credential",
        previous.id,
        { userId: input.userId, replacementBadgeId: id },
        now,
      ),
    );
  statements.push(
    db
      .prepare(
        "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM registrations WHERE event_id=? AND user_id=?) AND EXISTS(SELECT 1 FROM events WHERE id=? AND ends_at IS ?)",
      )
      .bind(
        id,
        eventId,
        input.userId,
        await hashBadgeCredential(credential),
        now,
        expiresAt,
        eventId,
        input.userId,
        eventId,
        event.ends_at,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      scope,
      "user",
      actorId,
      "badge_issued",
      "event_badge_credential",
      id,
      { userId: input.userId, replacedBadgeId: input.replaceBadgeId ?? null, expiresAt },
      now,
    ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes("audit_log.idempotency_key")) {
      const committed = await completedIssue(db, eventId, actorId, input, requestDigest);
      if (committed) return committed;
    }
    throwBadgeCommandError(error);
  }
  return badgeIssueResponseSchema.parse({
    result: "issued",
    id,
    credential,
    expiresAt,
    replacedBadgeId: previous?.id ?? null,
  });
}

/** Keep credential IDs for historical scan evidence; repeated revocation never rewrites the first receipt. */
export async function revokeBadge(db: DatabaseLike, eventId: string, actorId: string, id: string) {
  const badge = await ownedBadge(db, eventId, id);
  if (badge.revoked_at) return;
  const now = nowIso();
  try {
    await db.batch([
      prepareRevocation(db, eventId, badge, now),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: eventId },
        "user",
        actorId,
        "badge_revoked",
        "event_badge_credential",
        id,
        { userId: badge.user_id },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      const current = await ownedBadge(db, eventId, id);
      if (current.revoked_at && current.user_id === badge.user_id && current.credential_hash === badge.credential_hash)
        return;
      throw new AppError(409, "BADGE_CHANGED", "The badge changed. Refresh before continuing.");
    }
    throwBadgeCommandError(error);
  }
}
