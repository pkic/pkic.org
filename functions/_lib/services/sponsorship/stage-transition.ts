import { uuid } from "../../utils/ids";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { prepareAuditLogAfterOneChange } from "../audit";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { initialRenewalActionDueAt } from "./renewal-policy";

export interface SponsorshipStageSubject {
  id: string;
  sponsor_type: string;
  organization_id: string | null;
  pipeline_stage: string;
  transition_revision: number;
  renewal_date: string | null;
  assigned_to_user_id: string | null;
}

export interface PreparedSponsorshipStageTransition {
  statements: StatementLike[];
  fromStage: string;
  becameActive: boolean;
  becameLapsed: boolean;
}

export function prepareRefreshOrganizationSponsorshipProjection(
  db: DatabaseLike,
  organizationId: string,
): StatementLike {
  return db
    .prepare(
      `UPDATE organizations
       SET (sponsor_tier, sponsor_start_date) = (
             SELECT tier, start_date
             FROM sponsorships
             WHERE sponsor_type = 'consortium'
               AND organization_id = ?
               AND pipeline_stage = 'active'
             ORDER BY start_date DESC, id ASC
             LIMIT 1
           )
       WHERE id = ?`,
    )
    .bind(organizationId, organizationId);
}

/**
 * Builds the canonical CAS-protected sponsorship stage write set. Admin and
 * scheduled transitions both reuse this boundary so state, history, audit,
 * automation-cycle reset, and the organization projection cannot diverge.
 */
export function prepareSponsorshipStageTransition(
  db: DatabaseLike,
  subject: SponsorshipStageSubject,
  input: {
    toStage: string;
    /** `null` is reserved for unattended system transitions. */
    actor: AuthAdmin | null;
    note: string | null;
    auditAction: string;
    now: string;
    expectedRenewal?: { renewalDate: string; actionDueAt: string };
  },
): PreparedSponsorshipStageTransition {
  const fromStage = subject.pipeline_stage;
  const becameActive = input.toStage === "active" && fromStage !== "active";
  const becameLapsed = input.toStage === "lapsed" && fromStage !== "lapsed";
  const renewalActionDueAt = initialRenewalActionDueAt({
    pipelineStage: input.toStage,
    renewalDate: subject.renewal_date,
    assignedToUserId: subject.assigned_to_user_id,
  });
  const renewalGuardSql = input.expectedRenewal ? " AND renewal_date = ? AND renewal_action_due_at = ?" : "";
  const renewalGuardBindings = input.expectedRenewal
    ? [input.expectedRenewal.renewalDate, input.expectedRenewal.actionDueAt]
    : [];
  const auditActorId = input.actor?.id ?? null;
  const databaseActorUserId = input.actor ? adminDatabaseUserId(input.actor) : null;
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE sponsorships
         SET pipeline_stage = ?,
             start_date = CASE WHEN ? = 'active' THEN COALESCE(start_date, ?) ELSE start_date END,
             renewal_action_due_at = ?,
             updated_at = ?,
             transition_revision = transition_revision + 1
         WHERE id = ? AND pipeline_stage = ? AND transition_revision = ?${renewalGuardSql}`,
      )
      .bind(
        input.toStage,
        input.toStage,
        input.now,
        renewalActionDueAt,
        input.now,
        subject.id,
        fromStage,
        subject.transition_revision,
        ...renewalGuardBindings,
      ),
    prepareAuditLogAfterOneChange(
      db,
      input.actor ? "admin" : "system",
      auditActorId,
      input.auditAction,
      "sponsorship",
      subject.id,
      { fromStage, toStage: input.toStage },
      input.now,
    ),
    db
      .prepare(
        `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), subject.id, fromStage, input.toStage, databaseActorUserId, input.note, input.now),
  ];

  if (subject.sponsor_type === "consortium" && subject.organization_id) {
    statements.push(prepareRefreshOrganizationSponsorshipProjection(db, subject.organization_id));
  }

  return { statements, fromStage, becameActive, becameLapsed };
}
