/**
 * Staff dismiss affiliation reviews by group: everyone who wrote the same
 * organization name, in one set-based batch that audits every review it
 * closes. Nobody is linked to an organization by what they wrote: a person
 * joins through their verified work address (email-domain-link.ts and the
 * offer) or an identity invitation, and their own review closes when they do.
 */
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { auditActorIdentityId } from "../audit-actor";
import { prepareAuditLog } from "../audit";
import { getAffiliationReviewGroup } from "./affiliation-reviews";
import type { AffiliationReviewGroup } from "../../../../assets/shared/schemas/affiliation-reviews";

async function requireOpenGroup(db: DatabaseLike, groupKey: string): Promise<AffiliationReviewGroup> {
  const group = await getAffiliationReviewGroup(db, groupKey);
  if (group.openReviews === 0) throw new AppError(409, "REVIEW_DECIDED", "This group was already decided");
  return group;
}

async function decidedCount(db: DatabaseLike, decisionId: string): Promise<number> {
  const row = await first<{ decided: number }>(
    db,
    `SELECT COUNT(*) AS decided FROM audit_log
      WHERE action IN ('affiliation_review_resolved', 'affiliation_review_dismissed')
        AND json_extract(details_json, '$.decisionId.to') = ?`,
    [decisionId],
  );
  return Number(row?.decided ?? 0);
}

/** One audit row per review this decision closed, recognized by the closing staff member and instant. */
function prepareClosedReviewAudit(
  db: DatabaseLike,
  input: { action: string; staff: UserBackedAuthAdmin; at: string; decisionId: string; groupKey: string },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, actor_identity_id, action, entity_type, entity_id, details_json,
         created_at, scope_type, scope_id)
       SELECT lower(hex(randomblob(16))), 'admin', ?, ?, ?, 'affiliation_review', review.id,
              json_object(
                'decisionId', json_object('from', NULL, 'to', ?),
                'groupKey', json_object('from', NULL, 'to', review.group_key),
                'organizationName', json_object('from', NULL, 'to', review.organization_name),
                'identityId', json_object('from', NULL, 'to', review.resolved_identity_id)),
              ?, NULL, NULL
         FROM affiliation_reviews review
        WHERE review.group_key = ? AND review.resolved_at = ? AND review.resolved_by_user_id = ?`,
    )
    .bind(
      input.staff.id,
      auditActorIdentityId("admin", input.staff.id),
      input.action,
      input.decisionId,
      input.at,
      input.groupKey,
      input.at,
      input.staff.id,
    );
}

/** Records that no organization applies to anyone in the group; the text stays on record. */
export async function dismissAffiliationReviewGroup(
  db: DatabaseLike,
  groupKey: string,
  staff: UserBackedAuthAdmin,
): Promise<{ group: AffiliationReviewGroup; decided: number }> {
  await requireOpenGroup(db, groupKey);
  const at = nowIso();
  const decisionId = uuid();
  await db.batch([
    db
      .prepare(
        `UPDATE affiliation_reviews SET resolved_by_user_id = ?, resolved_at = ?
          WHERE group_key = ? AND resolved_at IS NULL`,
      )
      .bind(staff.id, at, groupKey),
    prepareClosedReviewAudit(db, { action: "affiliation_review_dismissed", staff, at, decisionId, groupKey }),
    prepareAuditLog(
      db,
      "admin",
      staff.id,
      "affiliation_review_group_dismissed",
      "affiliation_review_group",
      groupKey,
      { decisionId },
      at,
    ),
  ]);
  return { group: await getAffiliationReviewGroup(db, groupKey), decided: await decidedCount(db, decisionId) };
}
