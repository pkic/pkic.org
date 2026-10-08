import {
  eventEvidenceRetentionPolicyResponseSchema,
  eventEvidenceRetentionPolicyUpdateSchema,
  eventEvidenceRetentionPolicyMutationResponseSchema,
  type EventEvidenceRetentionPolicyUpdate,
} from "../../../../assets/shared/schemas/event-evidence-retention";
import { preparePermissionsAuthorizationGuard, requirePermission } from "../../auth/permissions";
import { first } from "../../db/queries";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";

function requirements(eventId: string, write = false) {
  return [
    { permission: "retention:read" },
    ...(write ? [{ permission: "retention:run" }] : []),
    { permission: "events:manage", context: { type: "event", id: eventId } },
  ];
}
function authorize(actor: UserBackedAuthAdmin, eventId: string, write = false) {
  for (const requirement of requirements(eventId, write))
    requirePermission(actor, requirement.permission, requirement.context);
  if (write && !actor.sessionId)
    throw new AppError(403, "HUMAN_SESSION_REQUIRED", "A live human session is required to change retention policy.");
}
function policyFields(input: EventEvidenceRetentionPolicyUpdate) {
  return {
    evidenceUntil: input.evidenceUntil,
    purposeCode: input.purposeCode,
    legalHold: input.legalHold,
    holdReasonCode: input.holdReasonCode,
  };
}
export async function readEventEvidenceRetentionPolicy(db: DatabaseLike, actor: UserBackedAuthAdmin, eventId: string) {
  authorize(actor, eventId);
  const row = await first<{
    revision: number;
    evidenceUntil: string | null;
    purposeCode: string | null;
    legalHold: number;
    holdReasonCode: string | null;
    captureClosedAt: string | null;
    purgedAt: string | null;
  }>(
    db,
    `SELECT COALESCE(p.revision,0) AS revision,p.evidence_until AS evidenceUntil,p.purpose_code AS purposeCode,
      COALESCE(p.legal_hold,0) AS legalHold,p.hold_reason_code AS holdReasonCode,s.capture_closed_at AS captureClosedAt,s.purged_at AS purgedAt
      FROM events e LEFT JOIN event_evidence_retention_policies p ON p.event_id=e.id
      LEFT JOIN event_evidence_retention_state s ON s.event_id=e.id WHERE e.id=?`,
    [eventId],
  );
  if (!row) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  const { revision, captureClosedAt, purgedAt, ...fields } = row;
  const policy = { ...fields, legalHold: row.legalHold === 1 };
  const status = purgedAt
    ? "purged"
    : policy.legalHold
      ? "held"
      : policy.evidenceUntil === null
        ? "unconfigured"
        : policy.evidenceUntil <= nowIso()
          ? "due"
          : "retained";
  return eventEvidenceRetentionPolicyResponseSchema.parse({
    success: true,
    eventId,
    revision,
    policy,
    captureClosedAt,
    purgedAt,
    status,
  });
}
interface Operation {
  event_id: string;
  actor_user_id: string;
  request_json: string;
  resulting_revision: number;
}
export async function updateEventEvidenceRetentionPolicy(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  input: EventEvidenceRetentionPolicyUpdate,
) {
  authorize(actor, eventId, true);
  const body = eventEvidenceRetentionPolicyUpdateSchema.parse(input);
  const requestJson = JSON.stringify({ eventId, actorUserId: actor.id, ...body });
  const lookup = () =>
    first<Operation>(
      db,
      `SELECT event_id,actor_user_id,request_json,resulting_revision FROM event_evidence_retention_policy_operations WHERE operation_id=?`,
      [body.operationId],
    );
  const replay = async (operation: Operation) => {
    if (
      operation.event_id !== eventId ||
      operation.actor_user_id !== actor.id ||
      operation.request_json !== requestJson
    )
      throw new AppError(
        409,
        "RETENTION_OPERATION_CONFLICT",
        "This operation identifier belongs to another policy request.",
      );
    try {
      await db.batch([preparePermissionsAuthorizationGuard(db, actor, requirements(eventId, true))]);
    } catch (error) {
      if (isAuthorizationGuardFailure(error))
        throw new AppError(
          409,
          "RETENTION_AUTHORIZATION_CHANGED",
          "Retention authority changed while replaying the policy operation.",
        );
      throw error;
    }
    return eventEvidenceRetentionPolicyMutationResponseSchema.parse({
      success: true,
      eventId,
      revision: operation.resulting_revision,
      policy: policyFields(body),
    });
  };
  const existing = await lookup();
  if (existing) return replay(existing);
  const createdAt = nowIso();
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, requirements(eventId, true)),
      db
        .prepare(
          `INSERT INTO event_evidence_retention_policies(event_id,revision,evidence_until,purpose_code,legal_hold,hold_reason_code,updated_by,updated_at)
        SELECT id,1,?,?,?,?,?,? FROM events WHERE id=? AND (?=0 OR EXISTS(SELECT 1 FROM event_evidence_retention_policies existing WHERE existing.event_id=events.id))
        ON CONFLICT(event_id) DO UPDATE SET revision=event_evidence_retention_policies.revision+1,
        evidence_until=?,purpose_code=?,legal_hold=?,hold_reason_code=?,updated_by=?,updated_at=?
        WHERE event_evidence_retention_policies.revision=?`,
        )
        .bind(
          body.evidenceUntil,
          body.purposeCode,
          Number(body.legalHold),
          body.holdReasonCode,
          actor.id,
          createdAt,
          eventId,
          body.expectedRevision,
          body.evidenceUntil,
          body.purposeCode,
          Number(body.legalHold),
          body.holdReasonCode,
          actor.id,
          createdAt,
          body.expectedRevision,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        actor.id,
        "event_evidence_retention_policy_updated",
        "event",
        eventId,
        { revision: body.expectedRevision + 1, ...policyFields(body) },
        createdAt,
        { type: "event", id: eventId },
      ),
      db
        .prepare(
          `INSERT INTO event_evidence_retention_policy_operations(operation_id,event_id,actor_user_id,expected_revision,resulting_revision,request_json,created_at) VALUES(?,?,?,?,?,?,?)`,
        )
        .bind(
          body.operationId,
          eventId,
          actor.id,
          body.expectedRevision,
          body.expectedRevision + 1,
          requestJson,
          createdAt,
        ),
    ]);
  } catch (error) {
    const operation = await lookup();
    if (operation) return replay(operation);
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "RETENTION_AUTHORIZATION_CHANGED",
        "Retention authority changed while saving the policy.",
      );
    if (isAuditChangeGuardFailure(error))
      throw new AppError(409, "RETENTION_POLICY_REVISION_CHANGED", "The policy changed. Reload before saving.");
    throw error;
  }
  return eventEvidenceRetentionPolicyMutationResponseSchema.parse({
    success: true,
    eventId,
    revision: body.expectedRevision + 1,
    policy: policyFields(body),
  });
}
