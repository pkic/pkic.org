/**
 * Executive Council review. EC membership (`users.is_ec_member`)
 * is a distinct designation from `membership:approve` — this module is used
 * both by the member-session EC decision path (an EC member is a regular
 * A-G/H member who happens to hold the flag) and the staff-admin override
 * fallback ("Staff admins can manually record an EC decision as a fallback
 * in exceptional access cases").
 */
import { all, first, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import { getMemberApplicationById } from "./membership/applications/queries";
import type { DatabaseLike } from "../types";

export type EcDecisionValue = "approve" | "decline";

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
  params: { applicationId: string; ecMemberUserId: string; decision: EcDecisionValue; reason?: string | null },
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
  if (existing) {
    await run(db, `UPDATE ec_decisions SET decision = ?, reason = ?, created_at = ? WHERE id = ?`, [
      params.decision,
      params.reason ?? null,
      now,
      existing.id,
    ]);
    return {
      id: existing.id,
      application_id: params.applicationId,
      ec_member_user_id: params.ecMemberUserId,
      decision: params.decision,
      reason: params.reason ?? null,
      created_at: now,
    };
  }

  const id = uuid();
  await run(
    db,
    `INSERT INTO ec_decisions (id, application_id, ec_member_user_id, decision, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, params.applicationId, params.ecMemberUserId, params.decision, params.reason ?? null, now],
  );
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
  return all<EcDecisionRow>(db, `SELECT * FROM ec_decisions WHERE application_id = ? ORDER BY created_at ASC`, [
    applicationId,
  ]);
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
