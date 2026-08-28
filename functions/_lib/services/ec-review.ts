/**
 * Executive Council review. EC membership (`users.is_ec_member`)
 * is a distinct designation from `membership:approve` — this module is used
 * both by the member-session EC decision path (an EC member is a regular
 * A-G/H member who happens to hold the flag) and the staff-admin override
 * fallback ("Staff admins can manually record an EC decision as a fallback
 * in exceptional access cases").
 */
import { all, first } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import { getMemberApplicationById } from "./membership/applications/queries";
import type { DatabaseLike } from "../types";
import type { EcDecisionValue } from "../../../assets/shared/schemas/ec-review";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";

export type { EcDecisionValue };

export interface EcDecisionRow {
  id: string;
  application_id: string;
  ec_member_user_id: string;
  decision: EcDecisionValue;
  reason: string | null;
  created_at: string;
}

/**
 * Records (or revises) an EC member's decision on an application currently
 * in ec_review. Revisable — Gives EC members a window to decide, not
 * a one-shot vote, and nothing forbids changing a decision before the
 * window closes or another EC member's decline halts the process.
 */
export async function recordEcDecision(
  db: DatabaseLike,
  params: {
    applicationId: string;
    ecMemberUserId: string;
    decision: EcDecisionValue;
    reason?: string | null;
    audit?: { actorType: "admin" | "member"; actorId: string; action: string };
  },
): Promise<EcDecisionRow> {
  const application = await getMemberApplicationById(db, params.applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }
  if (application.stage !== "ec_review") {
    throw new AppError(409, "APPLICATION_NOT_IN_EC_REVIEW", "Application is not currently in EC review");
  }
  if (params.decision === "decline" && !params.reason) {
    throw new AppError(422, "EC_DECLINE_REASON_REQUIRED", "A reason is required when declining");
  }

  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM ec_decisions WHERE application_id = ? AND ec_member_user_id = ?`,
    [params.applicationId, params.ecMemberUserId],
  );

  const now = nowIso();
  const id = existing?.id ?? uuid();
  const decisionStatement = existing
    ? db
        .prepare("UPDATE ec_decisions SET decision = ?, reason = ?, created_at = ? WHERE id = ?")
        .bind(params.decision, params.reason ?? null, now, id)
    : db
        .prepare(
          `INSERT INTO ec_decisions (id, application_id, ec_member_user_id, decision, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, params.applicationId, params.ecMemberUserId, params.decision, params.reason ?? null, now);
  const audit = params.audit ?? {
    actorType: "member" as const,
    actorId: params.ecMemberUserId,
    action: "ec_decision_recorded",
  };
  try {
    await db.batch([
      // Serialize decisions with every stage-changing command through the
      // application row. A concurrent approval changes stage/revision; a
      // decision changes revision, invalidating any approval snapshot that
      // was prepared before this decision committed.
      db
        .prepare(
          `UPDATE member_applications
           SET transition_revision = transition_revision + 1, updated_at = ?
           WHERE id = ? AND stage = 'ec_review' AND transition_revision = ?`,
        )
        .bind(now, application.id, application.transition_revision),
      // This must remain immediately after the CAS: changes() turns a lost
      // race into a statement failure, rolling back the audit and decision.
      prepareAuditLogAfterOneChange(
        db,
        audit.actorType,
        audit.actorId,
        audit.action,
        "member_application",
        params.applicationId,
        {
          ecMemberUserId: params.ecMemberUserId,
          decision: params.decision,
          reason: params.reason ?? null,
        },
        now,
      ),
      decisionStatement,
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "APPLICATION_NOT_IN_EC_REVIEW",
        "Application left EC review or changed while the decision was being prepared",
      );
    }
    throw error;
  }
  if (existing) {
    return {
      id,
      application_id: params.applicationId,
      ec_member_user_id: params.ecMemberUserId,
      decision: params.decision,
      reason: params.reason ?? null,
      created_at: now,
    };
  }

  return {
    id,
    application_id: params.applicationId,
    ec_member_user_id: params.ecMemberUserId,
    decision: params.decision,
    reason: params.reason ?? null,
    created_at: now,
  };
}

export async function listEcDecisions(db: DatabaseLike, applicationId: string): Promise<EcDecisionRow[]> {
  return all<EcDecisionRow>(
    db,
    `SELECT id, application_id, ec_member_user_id, decision, reason, created_at
     FROM ec_decisions WHERE application_id = ? ORDER BY created_at ASC`,
    [applicationId],
  );
}

/** True if any EC member has declined — halts auto-approval. */
export async function hasEcDecline(db: DatabaseLike, applicationId: string): Promise<boolean> {
  const row = await first<{ id: string }>(
    db,
    `SELECT id FROM ec_decisions WHERE application_id = ? AND decision = 'decline' LIMIT 1`,
    [applicationId],
  );
  return row !== null;
}
