import { AppError } from "../errors";
import { first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { prepareReferralConversionStatements } from "./referrals";
import { prepareEngagementStatement } from "./engagement";
import { prepareUpsertProposalParticipant } from "./proposal-participants";
import {
  issueDatabaseCapability,
  newCapabilityLinkSecret,
  queuedCapabilityToken,
  signCapabilityToken,
  verifyDatabaseCapability,
} from "./capability-links";
import type { DatabaseLike, StatementLike } from "../types";

export interface ProposalRecord {
  id: string;
  event_id: string;
  proposer_user_id: string;
  status: string;
  proposal_type: string;
  title: string;
  abstract: string;
  details_json: string | null;
  referral_code: string | null;
  manage_link_secret: string;
  submitted_at: string;
  updated_at: string;
  withdrawn_at: string | null;
  presentation_deadline?: string | null;
}

export const PROPOSAL_COLUMNS = `id, event_id, proposer_user_id, status, proposal_type, title, abstract,
  details_json, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at, presentation_deadline`;

export interface ProposalListRecord extends ProposalRecord {
  proposer_email: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  review_count: number;
  average_review_score?: number | null;
  recommendation_accept_count?: number;
  recommendation_needs_work_count?: number;
  recommendation_reject_count?: number;
  decision_status: "accepted" | "rejected" | "needs-work" | null;
  decision_note: string | null;
  decision_decided_at: string | null;
}

export async function buildCreateProposal(
  db: DatabaseLike,
  payload: {
    eventId: string;
    proposerUserId: string;
    proposalType: string;
    title: string;
    abstract: string;
    detailsJson?: string | null;
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
    referral_code: payload.referredByCode ?? null,
    manage_link_secret: manageLinkSecret,
    submitted_at: now,
    updated_at: now,
    withdrawn_at: null,
  };

  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO session_proposals (
      id, event_id, proposer_user_id, status, proposal_type, title, abstract,
      details_json, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        proposal.referral_code,
        proposal.manage_link_secret,
        proposal.submitted_at,
        proposal.updated_at,
        proposal.withdrawn_at,
      ),
    prepareUpsertProposalParticipant(db, {
      eventId: proposal.event_id,
      userId: proposal.proposer_user_id,
      proposalRole: "proposer",
      sourceRef: proposal.id,
    }),
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

export async function updateProposalByManageToken(
  db: DatabaseLike,
  payload: {
    manageToken: string;
    action: "update" | "withdraw";
    proposalType?: string;
    title?: string;
    abstract?: string;
    detailsJson?: string | null;
    signingSecret: string;
  },
): Promise<ProposalRecord> {
  const proposal = await getProposalByManageToken(db, payload.manageToken, payload.signingSecret);

  if (proposal.status === "accepted" || proposal.status === "rejected") {
    throw new AppError(409, "PROPOSAL_FINALIZED", "Finalized proposals cannot be changed");
  }

  if (payload.action === "withdraw") {
    const now = nowIso();
    await db.batch([
      db
        .prepare("UPDATE session_proposals SET status = 'withdrawn', withdrawn_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, proposal.id),
      db
        .prepare(
          `UPDATE event_participants
           SET status = 'inactive', updated_at = ?
           WHERE event_id = ? AND source_type = 'proposal' AND source_ref = ?`,
        )
        .bind(now, proposal.event_id, proposal.id),
    ]);
  } else {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [column, value] of [
      ["proposal_type", payload.proposalType],
      ["title", payload.title],
      ["abstract", payload.abstract],
      ["details_json", payload.detailsJson],
    ] as const) {
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(value);
    }
    assignments.push("status = CASE WHEN status = 'needs-work' THEN 'resubmitted' ELSE status END", "updated_at = ?");
    values.push(nowIso(), proposal.id);
    await run(db, `UPDATE session_proposals SET ${assignments.join(", ")} WHERE id = ?`, values);
  }

  const updated = await first<ProposalRecord>(db, `SELECT ${PROPOSAL_COLUMNS} FROM session_proposals WHERE id = ?`, [
    proposal.id,
  ]);
  if (!updated) {
    throw new AppError(500, "PROPOSAL_UPDATE_FAILED", "Unable to update proposal");
  }
  return updated;
}

export async function finalizeProposalDecision(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    decidedByUserId: string;
    finalStatus: "accepted" | "rejected" | "needs-work";
    decisionNote?: string | null;
    minReviewsRequired: number;
    presentationDeadline?: string | null;
    presentationReminderUserIds?: string[];
    additionalStatements?: StatementLike[];
  },
): Promise<{ reviewCount: number }> {
  const existingDecision = await first<{ id: string }>(db, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [
    payload.proposalId,
  ]);

  if (existingDecision) {
    throw new AppError(409, "PROPOSAL_ALREADY_FINALIZED", "Proposal already has a final decision");
  }

  const reviewCountRow = await first<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM proposal_reviews WHERE proposal_id = ?",
    [payload.proposalId],
  );
  const reviewCount = Number(reviewCountRow?.total ?? 0);

  if (reviewCount < payload.minReviewsRequired) {
    throw new AppError(
      409,
      "PROPOSAL_REVIEW_THRESHOLD_NOT_MET",
      `At least ${payload.minReviewsRequired} reviews required before finalizing`,
      { reviewCount, minRequired: payload.minReviewsRequired },
    );
  }

  const proposal = await first<ProposalRecord>(db, `SELECT ${PROPOSAL_COLUMNS} FROM session_proposals WHERE id = ?`, [
    payload.proposalId,
  ]);
  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  const now = nowIso();

  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO proposal_decisions (
      id, proposal_id, decided_by_user_id, final_status,
      decision_note, min_reviews_required, review_count, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uuid(),
        payload.proposalId,
        payload.decidedByUserId,
        payload.finalStatus,
        payload.decisionNote ?? null,
        payload.minReviewsRequired,
        reviewCount,
        now,
      ),
    db
      .prepare("UPDATE session_proposals SET status = ?, updated_at = ? WHERE id = ?")
      .bind(payload.finalStatus, now, payload.proposalId),
    db
      .prepare(
        `UPDATE event_participants
     SET status = ?, updated_at = ?
     WHERE event_id = ?
       AND source_type = 'proposal'
       AND source_ref = ?
       AND user_id IN (
         SELECT user_id
         FROM proposal_speakers
         WHERE proposal_id = ?
           AND status != 'declined'
       )`,
      )
      .bind(
        payload.finalStatus === "accepted" ? "active" : "inactive",
        now,
        proposal.event_id,
        payload.proposalId,
        payload.proposalId,
      ),
  ];
  if (payload.finalStatus === "accepted" && payload.presentationDeadline) {
    statements.push(
      db
        .prepare("UPDATE session_proposals SET presentation_deadline = ?, updated_at = ? WHERE id = ?")
        .bind(payload.presentationDeadline, now, payload.proposalId),
    );
  }
  for (const userId of payload.presentationReminderUserIds ?? []) {
    statements.push(
      db
        .prepare(
          `UPDATE proposal_speakers
           SET presentation_last_communication_at = ?, presentation_reminders_paused_until = NULL
           WHERE proposal_id = ? AND user_id = ?`,
        )
        .bind(now, payload.proposalId, userId),
    );
  }
  statements.push(...(payload.additionalStatements ?? []));
  await db.batch(statements);

  return { reviewCount };
}

export { getSpeakerByManageToken, type SpeakerWithContext } from "./proposals-speaker-capability";
export {
  addProposalSpeaker,
  buildAddProposalSpeaker,
  buildProposalInviteEmailContext,
  formatInvitePerson,
  listProposalSpeakersWithStatus,
  refreshSpeakerManageToken,
  updateProposalSpeakerRole,
} from "./proposal-speakers";
export type { ProposalInviteEmailContext, ProposalSpeakerRecord, ProposalSpeakerWithUser } from "./proposal-speakers";
export { listProposalReviews, updateProposalReview, upsertProposalReview } from "./proposal-reviews";
