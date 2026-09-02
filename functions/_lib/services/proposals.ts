import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { recordReferralConversion } from "./referrals";
import { recordEngagement } from "./engagement";
import {
  issueDatabaseCapability,
  newCapabilityLinkSecret,
  queuedCapabilityToken,
  signCapabilityToken,
  verifyDatabaseCapability,
} from "./capability-links";
import type { DatabaseLike } from "../types";

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

export interface ProposalReviewRecord {
  id: string;
  proposal_id: string;
  reviewer_user_id: string;
  recommendation: "accept" | "reject" | "needs-work";
  score: number | null;
  reviewer_comment: string | null;
  applicant_note: string | null;
  created_at: string;
  updated_at: string;
  reviewer_email?: string;
  reviewer_first_name?: string | null;
  reviewer_last_name?: string | null;
}

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

function participantRoleForProposalRole(role: string): { role: string; subrole: string | null } {
  if (role === "moderator") {
    return { role: "moderator", subrole: null };
  }
  if (role === "panelist") {
    return { role: "panelist", subrole: null };
  }
  return { role: "speaker", subrole: role };
}

async function upsertProposalParticipant(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    proposalRole: string;
    sourceRef: string;
    status?: "active" | "inactive";
  },
): Promise<void> {
  const participant = participantRoleForProposalRole(payload.proposalRole);
  const now = nowIso();

  await run(
    db,
    `INSERT INTO event_participants (
      id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'proposal', ?, ?, ?)
    ON CONFLICT(event_id, user_id, role, subrole)
    DO UPDATE SET status = excluded.status, source_ref = excluded.source_ref, updated_at = excluded.updated_at`,
    [
      uuid(),
      payload.eventId,
      payload.userId,
      participant.role,
      participant.subrole,
      payload.status ?? "active",
      payload.sourceRef,
      now,
      now,
    ],
  );
}

async function deactivateProposalParticipantRoles(
  db: DatabaseLike,
  payload: { eventId: string; userId: string; sourceRef: string },
): Promise<void> {
  await run(
    db,
    `UPDATE event_participants
     SET status = 'inactive', updated_at = ?
     WHERE event_id = ?
       AND user_id = ?
       AND source_type = 'proposal'
       AND source_ref = ?`,
    [nowIso(), payload.eventId, payload.userId, payload.sourceRef],
  );
}

export async function createProposal(
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
): Promise<{ proposal: ProposalRecord; manageToken: string }> {
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

  await run(
    db,
    `INSERT INTO session_proposals (
      id, event_id, proposer_user_id, status, proposal_type, title, abstract,
      details_json, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ],
  );

  await upsertProposalParticipant(db, {
    eventId: proposal.event_id,
    userId: proposal.proposer_user_id,
    proposalRole: "proposer",
    sourceRef: proposal.id,
  });

  await recordEngagement(db, {
    userId: proposal.proposer_user_id,
    eventId: proposal.event_id,
    subjectType: "proposal",
    subjectRef: proposal.id,
    actionType: "proposal_submitted",
    points: 8,
    sourceType: "proposal",
    sourceRef: proposal.id,
    data: { proposalType: proposal.proposal_type },
  });

  if (payload.referredByCode) {
    await recordReferralConversion(db, payload.referredByCode);
  }

  const manageToken = payload.signingSecret
    ? await signCapabilityToken({
        signingSecret: payload.signingSecret,
        linkSecret: proposal.manage_link_secret,
        purpose: "proposal_manage",
        resourceId: proposal.id,
      })
    : queuedCapabilityToken("proposal_manage", proposal.id);
  return { proposal, manageToken };
}

export interface ProposalSpeakerRecord {
  id: string;
  proposal_id: string;
  user_id: string;
  role: string;
  status: string;
  manage_link_secret: string | null;
  terms_accepted_at: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  created_at: string;
}

export async function addProposalSpeaker(
  db: DatabaseLike,
  payload: { proposalId: string; userId: string; role: string; signingSecret?: string },
): Promise<{ manageToken: string }> {
  // Proposers are auto-confirmed — they submitted the proposal and accepted terms.
  // Everyone still receives a manage token so they can update their profile and
  // upload their headshot / presentation after acceptance.
  const isProposer = payload.role === "proposer";
  const speakerId = uuid();
  const manageLinkSecret = newCapabilityLinkSecret();

  const status = isProposer ? "confirmed" : "invited";
  const confirmedAt = isProposer ? nowIso() : null;
  const now = nowIso();
  const proposal = await first<{ event_id: string; status: string }>(
    db,
    "SELECT event_id, status FROM session_proposals WHERE id = ?",
    [payload.proposalId],
  );

  await run(
    db,
    `INSERT INTO proposal_speakers
       (id, proposal_id, user_id, role, status, manage_link_secret, confirmed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(proposal_id, user_id) DO UPDATE SET
       role             = excluded.role,
       status           = CASE WHEN proposal_speakers.status = 'declined' THEN 'invited' ELSE proposal_speakers.status END,
       manage_link_secret = COALESCE(proposal_speakers.manage_link_secret, excluded.manage_link_secret),
       confirmed_at     = COALESCE(proposal_speakers.confirmed_at, excluded.confirmed_at),
       speaker_invite_reminder_count = CASE
         WHEN proposal_speakers.status = 'declined' THEN 0
         ELSE proposal_speakers.speaker_invite_reminder_count
       END,
       speaker_invite_last_communication_at = CASE
         WHEN proposal_speakers.status = 'declined' THEN excluded.created_at
         ELSE proposal_speakers.speaker_invite_last_communication_at
       END,
       speaker_invite_reminders_paused_until = CASE
         WHEN proposal_speakers.status = 'declined' THEN NULL
         ELSE proposal_speakers.speaker_invite_reminders_paused_until
       END`,
    [speakerId, payload.proposalId, payload.userId, payload.role, status, manageLinkSecret, confirmedAt, now],
  );

  if (proposal) {
    await deactivateProposalParticipantRoles(db, {
      eventId: proposal.event_id,
      userId: payload.userId,
      sourceRef: payload.proposalId,
    });
    await upsertProposalParticipant(db, {
      eventId: proposal.event_id,
      userId: payload.userId,
      proposalRole: payload.role,
      sourceRef: payload.proposalId,
      status: proposal.status === "accepted" ? "active" : "inactive",
    });
  }

  const speaker = await first<{ id: string; manage_link_secret: string | null }>(
    db,
    "SELECT id, manage_link_secret FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
    [payload.proposalId, payload.userId],
  );
  if (!speaker?.manage_link_secret) {
    throw new AppError(500, "SPEAKER_TOKEN_CREATE_FAILED", "Unable to create speaker manage link");
  }
  const manageToken = payload.signingSecret
    ? await signCapabilityToken({
        signingSecret: payload.signingSecret,
        linkSecret: speaker.manage_link_secret,
        purpose: "speaker_manage",
        resourceId: speaker.id,
      })
    : queuedCapabilityToken("speaker_manage", speaker.id);
  return { manageToken };
}

export async function updateProposalSpeakerRole(
  db: DatabaseLike,
  payload: { proposalId: string; userId: string; role: string },
): Promise<void> {
  const proposal = await first<{ event_id: string; status: string }>(
    db,
    "SELECT event_id, status FROM session_proposals WHERE id = ?",
    [payload.proposalId],
  );
  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  const result = await run(db, "UPDATE proposal_speakers SET role = ? WHERE proposal_id = ? AND user_id = ?", [
    payload.role,
    payload.proposalId,
    payload.userId,
  ]);
  if (result.changes === 0) {
    throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  }

  await deactivateProposalParticipantRoles(db, {
    eventId: proposal.event_id,
    userId: payload.userId,
    sourceRef: payload.proposalId,
  });
  await upsertProposalParticipant(db, {
    eventId: proposal.event_id,
    userId: payload.userId,
    proposalRole: payload.role,
    sourceRef: payload.proposalId,
    status: proposal.status === "accepted" ? "active" : "inactive",
  });
}

/**
 * Returns a queue-safe speaker capability placeholder without rotating the
 * speaker's revocation secret, so links from earlier messages remain valid.
 */
export async function refreshSpeakerManageToken(db: DatabaseLike, proposalId: string, userId: string): Promise<string> {
  const speaker = await first<{ id: string }>(
    db,
    "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
    [proposalId, userId],
  );
  if (!speaker) {
    throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  }
  return queuedCapabilityToken("speaker_manage", speaker.id);
}

/**
 * Issues a fresh expiring capability without rotating the proposal secret.
 */
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

export interface ProposalSpeakerWithUser {
  speaker_id: string;
  user_id: string;
  role: string;
  status: string;
  manage_link_secret: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  terms_accepted_at: string | null;
  decline_reason: string | null;
  created_at: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
}

export function formatInvitePerson(
  firstName: string | null,
  lastName: string | null,
  organizationName: string | null,
  fallback: string,
): string {
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName && organizationName?.trim()) {
    return `${fullName} (${organizationName.trim()})`;
  }
  if (fullName) {
    return fullName;
  }
  return fallback;
}

export interface ProposalInviteEmailContext {
  invitedByDisplay: string;
  proposalTitle: string;
  proposalAbstract: string;
  speakerLineupText: string;
}

export async function buildProposalInviteEmailContext(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    inviterUserId?: string | null;
  },
): Promise<ProposalInviteEmailContext> {
  const proposal = await first<{
    id: string;
    title: string;
    abstract: string;
    proposer_user_id: string;
  }>(db, "SELECT id, title, abstract, proposer_user_id FROM session_proposals WHERE id = ?", [payload.proposalId]);

  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  const inviterUserId = payload.inviterUserId ?? proposal.proposer_user_id;
  const inviter = await first<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  }>(db, "SELECT email, first_name, last_name, organization_name FROM users WHERE id = ?", [inviterUserId]);

  const speakers = await all<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
  }>(
    db,
    `SELECT u.email, u.first_name, u.last_name, u.organization_name
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ?
     ORDER BY ps.created_at ASC`,
    [proposal.id],
  );

  const speakerLineupText = speakers
    .map((entry) => `- ${formatInvitePerson(entry.first_name, entry.last_name, entry.organization_name, entry.email)}`)
    .join("\n");

  return {
    invitedByDisplay: inviter
      ? formatInvitePerson(inviter.first_name, inviter.last_name, inviter.organization_name, inviter.email)
      : "The proposer",
    proposalTitle: proposal.title,
    proposalAbstract: proposal.abstract,
    speakerLineupText,
  };
}

export async function listProposalSpeakersWithStatus(
  db: DatabaseLike,
  proposalId: string,
): Promise<ProposalSpeakerWithUser[]> {
  return all<ProposalSpeakerWithUser>(
    db,
    `SELECT
       ps.id         AS speaker_id,
       ps.user_id,
       ps.role,
       ps.status,
      ps.manage_link_secret,
       ps.confirmed_at,
       ps.declined_at,
       ps.terms_accepted_at,
       ps.decline_reason,
       ps.created_at,
       u.email,
       u.first_name,
       u.last_name,
       u.organization_name,
       u.job_title,
       u.biography,
       u.links_json,
       u.headshot_r2_key,
       u.headshot_updated_at
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ?
     ORDER BY ps.created_at ASC`,
    [proposalId],
  );
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
    "SELECT * FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
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
    await run(db, "UPDATE session_proposals SET status = 'withdrawn', withdrawn_at = ?, updated_at = ? WHERE id = ?", [
      nowIso(),
      nowIso(),
      proposal.id,
    ]);

    await run(
      db,
      `UPDATE event_participants
       SET status = 'inactive', updated_at = ?
       WHERE event_id = ? AND source_type = 'proposal' AND source_ref = ?`,
      [nowIso(), proposal.event_id, proposal.id],
    );
  } else {
    await run(
      db,
      `UPDATE session_proposals
       SET proposal_type = COALESCE(?, proposal_type),
           title = COALESCE(?, title),
           abstract = COALESCE(?, abstract),
           details_json = COALESCE(?, details_json),
           status = CASE WHEN status = 'needs-work' THEN 'resubmitted' ELSE status END,
           updated_at = ?
       WHERE id = ?`,
      [
        payload.proposalType ?? null,
        payload.title ?? null,
        payload.abstract ?? null,
        payload.detailsJson ?? null,
        nowIso(),
        proposal.id,
      ],
    );
  }

  const updated = await first<ProposalRecord>(db, "SELECT * FROM session_proposals WHERE id = ?", [proposal.id]);
  if (!updated) {
    throw new AppError(500, "PROPOSAL_UPDATE_FAILED", "Unable to update proposal");
  }
  return updated;
}

export async function upsertProposalReview(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    reviewerUserId: string;
    recommendation: "accept" | "reject" | "needs-work";
    score?: number | null;
    reviewerComment?: string | null;
    applicantNote?: string | null;
  },
): Promise<ProposalReviewRecord> {
  const now = nowIso();
  const existing = await first<ProposalReviewRecord>(
    db,
    `SELECT * FROM proposal_reviews
     WHERE proposal_id = ? AND reviewer_user_id = ?`,
    [payload.proposalId, payload.reviewerUserId],
  );

  if (!existing) {
    const review: ProposalReviewRecord = {
      id: uuid(),
      proposal_id: payload.proposalId,
      reviewer_user_id: payload.reviewerUserId,
      recommendation: payload.recommendation,
      score: payload.score ?? null,
      reviewer_comment: payload.reviewerComment ?? null,
      applicant_note: payload.applicantNote ?? null,
      created_at: now,
      updated_at: now,
    };

    await run(
      db,
      `INSERT INTO proposal_reviews (
        id, proposal_id, reviewer_user_id, recommendation, score,
        reviewer_comment, applicant_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        review.id,
        review.proposal_id,
        review.reviewer_user_id,
        review.recommendation,
        review.score,
        review.reviewer_comment,
        review.applicant_note,
        review.created_at,
        review.updated_at,
      ],
    );

    return review;
  }

  await run(
    db,
    `UPDATE proposal_reviews
     SET recommendation = ?, score = ?, reviewer_comment = ?, applicant_note = ?, updated_at = ?
     WHERE id = ?`,
    [
      payload.recommendation,
      payload.score ?? null,
      payload.reviewerComment ?? null,
      payload.applicantNote ?? null,
      now,
      existing.id,
    ],
  );

  const updated = await first<ProposalReviewRecord>(db, "SELECT * FROM proposal_reviews WHERE id = ?", [existing.id]);
  if (!updated) {
    throw new AppError(500, "PROPOSAL_REVIEW_UPDATE_FAILED", "Unable to update proposal review");
  }

  return updated;
}

export function buildProposalReviewAuditDetails(
  before: {
    recommendation: string | null;
    score: number | null;
    reviewerComment: string | null;
    applicantNote: string | null;
  },
  after: {
    recommendation: string | null;
    score: number | null;
    reviewerComment: string | null;
    applicantNote: string | null;
  },
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of Object.keys(after) as Array<keyof typeof after>) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }

  return changes;
}

export async function listProposalReviews(db: DatabaseLike, proposalId: string): Promise<ProposalReviewRecord[]> {
  return all<ProposalReviewRecord>(
    db,
    `SELECT
       pr.*,
       u.email      AS reviewer_email,
       u.first_name AS reviewer_first_name,
       u.last_name  AS reviewer_last_name
     FROM proposal_reviews pr
     JOIN users u ON u.id = pr.reviewer_user_id
     WHERE pr.proposal_id = ?
     ORDER BY pr.updated_at DESC`,
    [proposalId],
  );
}

export async function updateReviewById(
  db: DatabaseLike,
  reviewId: string,
  payload: {
    recommendation?: "accept" | "reject" | "needs-work";
    score?: number | null;
    reviewerComment?: string | null;
    applicantNote?: string | null;
  },
): Promise<ProposalReviewRecord> {
  const existing = await first<ProposalReviewRecord>(db, "SELECT * FROM proposal_reviews WHERE id = ?", [reviewId]);
  if (!existing) {
    throw new AppError(404, "PROPOSAL_REVIEW_NOT_FOUND", "Proposal review not found");
  }

  await run(
    db,
    `UPDATE proposal_reviews
     SET recommendation = COALESCE(?, recommendation),
         score = COALESCE(?, score),
         reviewer_comment = COALESCE(?, reviewer_comment),
         applicant_note = COALESCE(?, applicant_note),
         updated_at = ?
     WHERE id = ?`,
    [
      payload.recommendation ?? null,
      payload.score ?? null,
      payload.reviewerComment ?? null,
      payload.applicantNote ?? null,
      nowIso(),
      reviewId,
    ],
  );

  const updated = await first<ProposalReviewRecord>(db, "SELECT * FROM proposal_reviews WHERE id = ?", [reviewId]);
  if (!updated) {
    throw new AppError(500, "PROPOSAL_REVIEW_UPDATE_FAILED", "Unable to update proposal review");
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
  },
): Promise<{ reviewCount: number }> {
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

  const proposal = await first<ProposalRecord>(db, "SELECT * FROM session_proposals WHERE id = ?", [
    payload.proposalId,
  ]);
  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  const now = nowIso();
  const mappedStatus = payload.finalStatus;

  // Batched atomically so a concurrent re-finalize can't leave the decision,
  // proposal status, and participant records disagreeing with each other.
  await db.batch([
    db
      .prepare(
        `INSERT INTO proposal_decisions (
          id, proposal_id, decided_by_user_id, final_status,
          decision_note, min_reviews_required, review_count, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(proposal_id) DO UPDATE SET
          decided_by_user_id = excluded.decided_by_user_id,
          final_status = excluded.final_status,
          decision_note = excluded.decision_note,
          min_reviews_required = excluded.min_reviews_required,
          review_count = excluded.review_count,
          decided_at = excluded.decided_at`,
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
      .bind(mappedStatus, now, payload.proposalId),
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
  ]);

  return { reviewCount };
}

export { getSpeakerByManageToken, type SpeakerWithContext } from "./proposals-speaker-capability";
export { markProposalStatus, softDeleteProposal } from "./proposals-admin";
