import { AppError } from "../errors";
import { first } from "../db/queries";
import { batchFirst } from "../db/pagination";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { prepareReferralConversionStatements } from "./referrals";
import { prepareEngagementStatement } from "./engagement";
import { prepareProposalRoleCapacityForProposalStatus } from "./proposal-role-capacity";
import {
  issueDatabaseCapability,
  newCapabilityLinkSecret,
  queuedCapabilityToken,
  signCapabilityToken,
  verifyDatabaseCapability,
} from "./capability-links";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import {
  isProposalSelfServiceEditableStatus,
  type ProposalDecisionStatus,
  type ProposalStatus,
} from "../../../assets/shared/schemas/proposal-status";
import type { ProposalType } from "../../../assets/shared/schemas/proposal-management";
import { parseJsonSafe } from "../utils/json";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { prepareCancelProposalEmails } from "./proposal-email-cancellation";
import { recordProposalDecision } from "./proposal-decisions";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import { isProposalSpeakerRosterConflict } from "./proposal-speaker-roster-revision";
import { formSubmissionContextChangedError, isFormSubmissionContextConflict } from "./forms";

export interface ProposalRecord {
  id: string;
  event_id: string;
  proposer_user_id: string;
  status: ProposalStatus;
  proposal_type: ProposalType;
  title: string;
  abstract: string;
  details_json: string | null;
  form_placement_id: string | null;
  referral_code: string | null;
  manage_link_secret: string;
  review_round: number;
  submitted_at: string;
  updated_at: string;
  withdrawn_at: string | null;
  presentation_deadline?: string | null;
}

export const PROPOSAL_COLUMNS = `id, event_id, proposer_user_id, status, proposal_type, title, abstract,
  details_json, form_placement_id, referral_code, manage_link_secret, review_round, submitted_at, updated_at, withdrawn_at,
  presentation_deadline`;

export interface ProposalListRecord extends ProposalRecord {
  proposer_email: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  review_count: number;
  average_review_score?: number | null;
  recommendation_accept_count?: number;
  recommendation_needs_work_count?: number;
  recommendation_reject_count?: number;
  decision_status: ProposalDecisionStatus | null;
  decision_note: string | null;
  decision_decided_at: string | null;
}

export async function buildCreateProposal(
  db: DatabaseLike,
  payload: {
    eventId: string;
    proposerUserId: string;
    proposalType: ProposalType;
    title: string;
    abstract: string;
    detailsJson?: string | null;
    formPlacementId?: string | null;
    referredByCode?: string | null;
    signingSecret?: string;
  },
): Promise<{ proposal: ProposalRecord; manageToken: string; statements: StatementLike[] }> {
  const now = nowIso();
  const manageLinkSecret = newCapabilityLinkSecret();

  const proposal: ProposalRecord = {
    id: uuid(),
    event_id: payload.eventId,
    proposer_user_id: payload.proposerUserId,
    status: "submitted",
    proposal_type: payload.proposalType,
    title: payload.title,
    abstract: payload.abstract,
    details_json: payload.detailsJson ?? null,
    form_placement_id: payload.formPlacementId ?? null,
    referral_code: payload.referredByCode ?? null,
    manage_link_secret: manageLinkSecret,
    review_round: 1,
    submitted_at: now,
    updated_at: now,
    withdrawn_at: null,
  };

  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO session_proposals (
      id, event_id, proposer_user_id, status, proposal_type, title, abstract,
      details_json, form_placement_id, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        proposal.id,
        proposal.event_id,
        proposal.proposer_user_id,
        proposal.status,
        proposal.proposal_type,
        proposal.title,
        proposal.abstract,
        proposal.details_json,
        proposal.form_placement_id,
        proposal.referral_code,
        proposal.manage_link_secret,
        proposal.submitted_at,
        proposal.updated_at,
        proposal.withdrawn_at,
      ),
    prepareEngagementStatement(db, {
      userId: proposal.proposer_user_id,
      eventId: proposal.event_id,
      subjectType: "proposal",
      subjectRef: proposal.id,
      actionType: "proposal_submitted",
      points: 8,
      sourceType: "proposal",
      sourceRef: proposal.id,
      idempotencyKey: `proposal_submitted:proposal:${proposal.id}`,
      data: { proposalType: proposal.proposal_type },
    }),
  ];

  if (payload.referredByCode) {
    statements.push(
      ...(await prepareReferralConversionStatements(db, payload.referredByCode, {
        type: "proposal",
        ref: proposal.id,
      })),
    );
  }
  const manageToken = payload.signingSecret
    ? await signCapabilityToken({
        signingSecret: payload.signingSecret,
        linkSecret: proposal.manage_link_secret,
        purpose: "proposal_manage",
        resourceId: proposal.id,
      })
    : queuedCapabilityToken("proposal_manage", proposal.id);
  return { proposal, manageToken, statements };
}

export async function createProposal(
  db: DatabaseLike,
  payload: Parameters<typeof buildCreateProposal>[1],
): Promise<{ proposal: ProposalRecord; manageToken: string }> {
  const { proposal, manageToken, statements } = await buildCreateProposal(db, payload);
  await db.batch(statements);
  return { proposal, manageToken };
}

export async function refreshProposalManageToken(
  db: DatabaseLike,
  proposalId: string,
  signingSecret: string,
  ttlSeconds?: number,
): Promise<string> {
  return issueDatabaseCapability({
    db,
    signingSecret,
    purpose: "proposal_manage",
    resourceId: proposalId,
    ttlSeconds,
  });
}

export async function getProposalByManageToken(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
): Promise<ProposalRecord> {
  const verified = await verifyDatabaseCapability({
    db,
    signingSecret,
    purpose: "proposal_manage",
    token: manageToken,
  });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "PROPOSAL_TOKEN_EXPIRED" : "PROPOSAL_NOT_FOUND",
      verified.reason === "expired" ? "Proposal manage link has expired" : "Invalid proposal manage token",
    );
  }
  const proposal = await first<ProposalRecord>(
    db,
    `SELECT ${PROPOSAL_COLUMNS} FROM session_proposals WHERE id = ? AND deleted_at IS NULL`,
    [verified.resourceId],
  );

  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Invalid proposal manage token");
  }

  return proposal;
}

export async function getProposalById(db: DatabaseLike, proposalId: string): Promise<ProposalRecord> {
  const proposal = await first<ProposalRecord>(
    db,
    `SELECT ${PROPOSAL_COLUMNS} FROM session_proposals WHERE id = ? AND deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  return proposal;
}

export async function updateProposalByManageToken(
  db: DatabaseLike,
  payload: {
    manageToken: string;
    action: "update" | "withdraw";
    proposalType?: ProposalType;
    title?: string;
    abstract?: string;
    detailsJson?: string | null;
    signingSecret: string;
  },
): Promise<ProposalRecord> {
  const proposal = await getProposalByManageToken(db, payload.manageToken, payload.signingSecret);
  return updateProposalForVerifiedOwner(db, proposal, {
    action: payload.action,
    proposalType: payload.proposalType,
    title: payload.title,
    abstract: payload.abstract,
    detailsJson: payload.detailsJson,
  });
}

export async function updateProposalForVerifiedOwner(
  db: DatabaseLike,
  proposal: ProposalRecord,
  payload: {
    action: "update" | "withdraw";
    proposalType?: ProposalType;
    title?: string;
    abstract?: string;
    detailsJson?: string | null;
    formRevisionGuard?: StatementLike | null;
    formPlacementId?: string | null;
    formSubmissionStatements?: StatementLike[];
  },
): Promise<ProposalRecord> {
  if (!isProposalSelfServiceEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_NOT_EDITABLE", "This proposal can no longer be changed");
  }

  const now = nowIso();
  if (payload.action === "withdraw") {
    const withdrawalCondition = {
      sql: "SELECT 1 FROM session_proposals WHERE id = ? AND status = 'withdrawn' AND withdrawn_at = ? AND updated_at = ?",
      bindings: [proposal.id, now, now],
    };
    let withdrawalResults;
    try {
      withdrawalResults = await db.batch([
        db
          .prepare(
            `UPDATE session_proposals
           SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
           WHERE id = ? AND status = ? AND review_round = ? AND updated_at = ? AND deleted_at IS NULL`,
          )
          .bind(now, now, proposal.id, proposal.status, proposal.review_round, proposal.updated_at),
        prepareAuditLogAfterOneChange(
          db,
          "user",
          proposal.proposer_user_id,
          "proposal_withdrawn",
          "proposal",
          proposal.id,
          { status: { from: proposal.status, to: "withdrawn" } },
          now,
        ),
        prepareCancelProposalEmails(
          db,
          {
            proposalId: proposal.id,
            eventId: proposal.event_id,
            reason: "Cancelled because the proposal was withdrawn",
            conditionSql: withdrawalCondition.sql,
            conditionBindings: withdrawalCondition.bindings,
          },
          now,
        ),
        ...(await prepareProposalRoleCapacityForProposalStatus(db, {
          eventId: proposal.event_id,
          sourceRef: proposal.id,
          nextStatus: "inactive",
        })),
        db.prepare(`SELECT ${PROPOSAL_COLUMNS} FROM session_proposals WHERE id = ?`).bind(proposal.id),
      ]);
    } catch (error) {
      if (isRegistrationTransitionConflict(error)) {
        throw registrationChangedError();
      }
      if (
        isAuditOneChangeGuardFailure(error) ||
        isEventParticipantSourceConflict(error) ||
        isProposalSpeakerRosterConflict(error)
      ) {
        throw new AppError(409, "PROPOSAL_EDIT_CONFLICT", "Proposal changed while the withdrawal was processed");
      }
      throw error;
    }
    // The immediate audit guard above is the authoritative one-change check.
    // D1's per-statement change metadata can be affected by nested revision
    // trigger writes, so do not reclassify a successfully guarded batch.
    const selected = withdrawalResults.at(-1)!;
    const withdrawn = batchFirst<ProposalRecord>(selected);
    if (!withdrawn) throw new AppError(500, "PROPOSAL_UPDATE_FAILED", "Unable to load the withdrawn proposal");
    return withdrawn;
  }

  const next = {
    proposalType: payload.proposalType ?? proposal.proposal_type,
    title: payload.title ?? proposal.title,
    abstract: payload.abstract ?? proposal.abstract,
    detailsJson: payload.detailsJson !== undefined ? payload.detailsJson : proposal.details_json,
    formPlacementId: payload.detailsJson !== undefined ? (payload.formPlacementId ?? null) : proposal.form_placement_id,
    status: proposal.status === "needs-work" ? "resubmitted" : proposal.status,
    reviewRound: proposal.status === "needs-work" ? proposal.review_round + 1 : proposal.review_round,
  };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, from, to] of [
    ["proposalType", proposal.proposal_type, next.proposalType],
    ["title", proposal.title, next.title],
    ["abstract", proposal.abstract, next.abstract],
    [
      "details",
      parseJsonSafe<Record<string, unknown> | null>(proposal.details_json, null),
      parseJsonSafe<Record<string, unknown> | null>(next.detailsJson, null),
    ],
    ["status", proposal.status, next.status],
    ["formPlacementId", proposal.form_placement_id, next.formPlacementId],
    ["reviewRound", proposal.review_round, next.reviewRound],
  ] as const) {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  if (Object.keys(changes).length === 0) return proposal;

  const requiresDecisionRelease = proposal.status === "needs-work";
  let updateResults;
  try {
    updateResults = await db.batch([
      ...(payload.detailsJson !== undefined && payload.formRevisionGuard && !payload.formSubmissionStatements
        ? [payload.formRevisionGuard]
        : []),
      db
        .prepare(
          `UPDATE session_proposals
         SET proposal_type = ?, title = ?, abstract = ?, details_json = ?, form_placement_id = ?,
             status = ?, review_round = ?, updated_at = ?
         WHERE id = ? AND proposal_type = ? AND title = ? AND abstract = ? AND details_json IS ?
           AND status = ? AND review_round = ? AND updated_at = ? AND deleted_at IS NULL
           AND (? = 0 OR EXISTS (
             SELECT 1 FROM proposal_decisions
             WHERE proposal_id = ? AND review_round = ? AND final_status = 'needs-work'
           ))`,
        )
        .bind(
          next.proposalType,
          next.title,
          next.abstract,
          next.detailsJson,
          next.formPlacementId,
          next.status,
          next.reviewRound,
          now,
          proposal.id,
          proposal.proposal_type,
          proposal.title,
          proposal.abstract,
          proposal.details_json,
          proposal.status,
          proposal.review_round,
          proposal.updated_at,
          requiresDecisionRelease ? 1 : 0,
          proposal.id,
          proposal.review_round,
        ),
      ...(payload.formSubmissionStatements ?? []),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        proposal.proposer_user_id,
        "proposal_edited",
        "proposal",
        proposal.id,
        changes,
        now,
      ),
      db
        .prepare(
          `DELETE FROM proposal_decisions
         WHERE ? = 1 AND proposal_id = ? AND review_round = ? AND final_status = 'needs-work'
           AND EXISTS (
             SELECT 1 FROM session_proposals
             WHERE id = ? AND status = ? AND review_round = ? AND updated_at = ?
           )`,
        )
        .bind(
          requiresDecisionRelease ? 1 : 0,
          proposal.id,
          proposal.review_round,
          proposal.id,
          next.status,
          next.reviewRound,
          now,
        ),
      db.prepare(`SELECT ${PROPOSAL_COLUMNS} FROM session_proposals WHERE id = ?`).bind(proposal.id),
    ]);
  } catch (error) {
    if (isFormSubmissionContextConflict(error)) {
      throw formSubmissionContextChangedError();
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "PROPOSAL_EDIT_CONFLICT", "Proposal changed while the update was processed");
    }
    throw error;
  }
  const selected = updateResults.at(-1)!;
  const saved = batchFirst<ProposalRecord>(selected);
  if (!saved) throw new AppError(500, "PROPOSAL_UPDATE_FAILED", "Unable to load the updated proposal");
  return saved;
}

export async function finalizeProposalDecision(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    actor: AuthAdmin;
    finalStatus: "accepted" | "rejected" | "needs-work";
    decisionNote?: string | null;
    minReviewsRequired: number;
    presentationDeadline?: string | null;
    presentationReminderUserIds?: string[];
  },
): Promise<{ reviewCount: number }> {
  const result = await recordProposalDecision(db, {
    ...payload,
  });
  return { reviewCount: result.reviewCount };
}

export { getSpeakerByManageToken, type SpeakerWithContext } from "./proposals-speaker-capability";
export { buildProposalInviteEmailContext, type ProposalInviteEmailContext } from "./proposal-invite-email-context";
export {
  addProposalSpeaker,
  buildAddProposalSpeaker,
  formatInvitePerson,
  listProposalSpeakersWithStatus,
  refreshSpeakerManageToken,
  updateProposalSpeakerRole,
} from "./proposal-speakers";
export type { ProposalSpeakerRecord, ProposalSpeakerWithUser } from "./proposal-speakers";
export { listProposalReviews, updateProposalReview, upsertProposalReview } from "./proposal-reviews";
export { recordProposalDecision } from "./proposal-decisions";
