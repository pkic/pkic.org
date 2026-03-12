import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { randomToken, sha256Hex } from "../utils/crypto";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { recordReferralConversion } from "./referrals";
import { recordEngagement } from "./engagement";
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
  manage_token_hash: string;
  submitted_at: string;
  updated_at: string;
  withdrawn_at: string | null;
  /** Added by migration 0010. */
  presentation_r2_key?: string | null;
  presentation_deadline?: string | null;
  presentation_uploaded_at?: string | null;
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
  decision_status: "accepted" | "rejected" | "needs_work" | null;
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
  },
): Promise<{ proposal: ProposalRecord; manageToken: string }> {
  const now = nowIso();
  const manageToken = randomToken(24);
  const manageHash = await sha256Hex(manageToken);

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
    manage_token_hash: manageHash,
    submitted_at: now,
    updated_at: now,
    withdrawn_at: null,
  };

  await run(
    db,
    `INSERT INTO session_proposals (
      id, event_id, proposer_user_id, status, proposal_type, title, abstract,
      details_json, referral_code, manage_token_hash, submitted_at, updated_at, withdrawn_at
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
      proposal.manage_token_hash,
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

  return { proposal, manageToken };
}

export interface ProposalSpeakerRecord {
  id: string;
  proposal_id: string;
  user_id: string;
  role: string;
  status: string;
  manage_token_hash: string | null;
  terms_accepted_at: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  created_at: string;
}

export async function addProposalSpeaker(
  db: DatabaseLike,
  payload: { proposalId: string; userId: string; role: string },
): Promise<{ manageToken: string }> {
  // Proposers are auto-confirmed — they submitted the proposal and accepted terms.
  // Everyone still receives a manage token so they can update their profile and
  // upload their headshot / presentation after acceptance.
  const isProposer = payload.role === "proposer";
  const manageToken = randomToken(24);
  const manageTokenHash = await sha256Hex(manageToken);

  const status = isProposer ? "confirmed" : "invited";
  const confirmedAt = isProposer ? nowIso() : null;
  const now = nowIso();

  await run(
    db,
    `INSERT INTO proposal_speakers
       (id, proposal_id, user_id, role, status, manage_token_hash, confirmed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(proposal_id, user_id) DO UPDATE SET
       role             = excluded.role,
       status           = CASE WHEN proposal_speakers.status = 'declined' THEN 'invited' ELSE proposal_speakers.status END,
       manage_token_hash = COALESCE(proposal_speakers.manage_token_hash, excluded.manage_token_hash),
       confirmed_at     = COALESCE(proposal_speakers.confirmed_at, excluded.confirmed_at)`,
    [uuid(), payload.proposalId, payload.userId, payload.role, status, manageTokenHash, confirmedAt, now],
  );

  const proposal = await first<{ event_id: string }>(db, "SELECT event_id FROM session_proposals WHERE id = ?", [payload.proposalId]);
  if (proposal) {
    await upsertProposalParticipant(db, {
      eventId: proposal.event_id,
      userId: payload.userId,
      proposalRole: payload.role,
      sourceRef: payload.proposalId,
    });
  }

  return { manageToken };
}

export interface SpeakerWithContext {
  speaker: ProposalSpeakerRecord;
  proposal: ProposalRecord;
  user: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
    headshot_r2_key: string | null;
    headshot_updated_at: string | null;
  };
}

export async function getSpeakerByManageToken(
  db: DatabaseLike,
  manageToken: string,
): Promise<SpeakerWithContext> {
  const hash = await sha256Hex(manageToken);
  const row = await first<{
    // proposal_speakers
    ps_id: string;
    ps_proposal_id: string;
    ps_user_id: string;
    ps_role: string;
    ps_status: string;
    ps_manage_token_hash: string | null;
    ps_terms_accepted_at: string | null;
    ps_confirmed_at: string | null;
    ps_declined_at: string | null;
    ps_decline_reason: string | null;
    ps_created_at: string;
    // session_proposals
    sp_id: string;
    sp_event_id: string;
    sp_proposer_user_id: string;
    sp_status: string;
    sp_proposal_type: string;
    sp_title: string;
    sp_abstract: string;
    sp_details_json: string | null;
    sp_referral_code: string | null;
    sp_manage_token_hash: string;
    sp_submitted_at: string;
    sp_updated_at: string;
    sp_withdrawn_at: string | null;
    sp_presentation_r2_key: string | null;
    sp_presentation_deadline: string | null;
    sp_presentation_uploaded_at: string | null;
    // users
    u_id: string;
    u_email: string;
    u_first_name: string | null;
    u_last_name: string | null;
    u_organization_name: string | null;
    u_job_title: string | null;
    u_biography: string | null;
    u_links_json: string | null;
    u_headshot_r2_key: string | null;
    u_headshot_updated_at: string | null;
  }>(
    db,
    `SELECT
       ps.id              AS ps_id,
       ps.proposal_id     AS ps_proposal_id,
       ps.user_id         AS ps_user_id,
       ps.role            AS ps_role,
       ps.status          AS ps_status,
       ps.manage_token_hash AS ps_manage_token_hash,
       ps.terms_accepted_at AS ps_terms_accepted_at,
       ps.confirmed_at    AS ps_confirmed_at,
       ps.declined_at     AS ps_declined_at,
       ps.decline_reason  AS ps_decline_reason,
       ps.created_at      AS ps_created_at,
       sp.id              AS sp_id,
       sp.event_id        AS sp_event_id,
       sp.proposer_user_id AS sp_proposer_user_id,
       sp.status          AS sp_status,
       sp.proposal_type   AS sp_proposal_type,
       sp.title           AS sp_title,
       sp.abstract        AS sp_abstract,
       sp.details_json    AS sp_details_json,
       sp.referral_code   AS sp_referral_code,
       sp.manage_token_hash AS sp_manage_token_hash,
       sp.submitted_at    AS sp_submitted_at,
       sp.updated_at      AS sp_updated_at,
       sp.withdrawn_at    AS sp_withdrawn_at,
       sp.presentation_r2_key        AS sp_presentation_r2_key,
       sp.presentation_deadline      AS sp_presentation_deadline,
       sp.presentation_uploaded_at   AS sp_presentation_uploaded_at,
       u.id               AS u_id,
       u.email            AS u_email,
       u.first_name       AS u_first_name,
       u.last_name        AS u_last_name,
       u.organization_name AS u_organization_name,
       u.job_title        AS u_job_title,
       u.biography        AS u_biography,
       u.links_json       AS u_links_json,
       u.headshot_r2_key  AS u_headshot_r2_key,
       u.headshot_updated_at AS u_headshot_updated_at
     FROM proposal_speakers ps
     JOIN session_proposals sp ON sp.id = ps.proposal_id
     JOIN users u              ON u.id  = ps.user_id
     WHERE ps.manage_token_hash = ?`,
    [hash],
  );

  if (!row) {
    throw new AppError(404, "SPEAKER_TOKEN_NOT_FOUND", "Invalid or expired speaker token");
  }

  return {
    speaker: {
      id: row.ps_id,
      proposal_id: row.ps_proposal_id,
      user_id: row.ps_user_id,
      role: row.ps_role,
      status: row.ps_status,
      manage_token_hash: row.ps_manage_token_hash,
      terms_accepted_at: row.ps_terms_accepted_at,
      confirmed_at: row.ps_confirmed_at,
      declined_at: row.ps_declined_at,
      decline_reason: row.ps_decline_reason,
      created_at: row.ps_created_at,
    },
    proposal: {
      id: row.sp_id,
      event_id: row.sp_event_id,
      proposer_user_id: row.sp_proposer_user_id,
      status: row.sp_status,
      proposal_type: row.sp_proposal_type,
      title: row.sp_title,
      abstract: row.sp_abstract,
      details_json: row.sp_details_json,
      referral_code: row.sp_referral_code,
      manage_token_hash: row.sp_manage_token_hash,
      submitted_at: row.sp_submitted_at,
      updated_at: row.sp_updated_at,
      withdrawn_at: row.sp_withdrawn_at,
    },
    user: {
      id: row.u_id,
      email: row.u_email,
      first_name: row.u_first_name,
      last_name: row.u_last_name,
      organization_name: row.u_organization_name,
      job_title: row.u_job_title,
      biography: row.u_biography,
      links_json: row.u_links_json,
      headshot_r2_key: row.u_headshot_r2_key,
      headshot_updated_at: row.u_headshot_updated_at,
    },
  };
}

export async function confirmSpeakerParticipation(
  db: DatabaseLike,
  manageToken: string,
  payload: { termsAccepted: boolean },
): Promise<void> {
  const { speaker } = await getSpeakerByManageToken(db, manageToken);

  if (speaker.status === "confirmed") {
    return; // idempotent
  }
  if (speaker.status === "declined") {
    throw new AppError(409, "SPEAKER_ALREADY_DECLINED", "You have already declined participation. Please contact the organiser if you changed your mind.");
  }
  if (!payload.termsAccepted) {
    throw new AppError(400, "TERMS_NOT_ACCEPTED", "You must accept the participation terms to confirm.");
  }

  const now = nowIso();
  await run(
    db,
    `UPDATE proposal_speakers
     SET status = 'confirmed', confirmed_at = ?, terms_accepted_at = ?
     WHERE id = ?`,
    [now, now, speaker.id],
  );
}

export async function declineSpeakerParticipation(
  db: DatabaseLike,
  manageToken: string,
  payload: { reason?: string | null },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken);

  if (speaker.status === "declined") {
    return; // idempotent
  }

  const now = nowIso();
  await run(
    db,
    `UPDATE proposal_speakers
     SET status = 'declined', declined_at = ?, decline_reason = ?
     WHERE id = ?`,
    [now, payload.reason ?? null, speaker.id],
  );

  // Mark the participant as inactive in the event roster.
  await run(
    db,
    `UPDATE event_participants
     SET status = 'inactive', updated_at = ?
     WHERE event_id = ? AND user_id = ? AND source_type = 'proposal' AND source_ref = ?`,
    [now, proposal.event_id, speaker.user_id, proposal.id],
  );
}

export async function updateSpeakerProfile(
  db: DatabaseLike,
  userId: string,
  payload: {
    biography?: string | null;
    linksJson?: string | null;
    headshotR2Key?: string | null;
  },
): Promise<void> {
  const now = nowIso();
  const headshotUpdatedAt = payload.headshotR2Key !== undefined ? now : null;

  await run(
    db,
    `UPDATE users
     SET
       biography         = COALESCE(?, biography),
       links_json        = COALESCE(?, links_json),
       headshot_r2_key   = COALESCE(?, headshot_r2_key),
       headshot_updated_at = CASE WHEN ? IS NOT NULL THEN ? ELSE headshot_updated_at END,
       updated_at        = ?
     WHERE id = ?`,
    [
      payload.biography ?? null,
      payload.linksJson ?? null,
      payload.headshotR2Key ?? null,
      payload.headshotR2Key ?? null,
      headshotUpdatedAt,
      now,
      userId,
    ],
  );
}

export async function recordPresentationUpload(
  db: DatabaseLike,
  proposalId: string,
  r2Key: string,
): Promise<void> {
  const now = nowIso();
  await run(
    db,
    `UPDATE session_proposals
     SET presentation_r2_key = ?, presentation_uploaded_at = ?, updated_at = ?
     WHERE id = ?`,
    [r2Key, now, now, proposalId],
  );
}

/**
 * Generates a fresh manage token for a specific speaker on a proposal.
 * Useful when sending follow-up emails (e.g., profile request, presentation
 * reminder) where the original raw token is no longer available.
 * The old token is invalidated — existing links will stop working.
 */
export async function refreshSpeakerManageToken(
  db: DatabaseLike,
  proposalId: string,
  userId: string,
): Promise<string> {
  const token = randomToken(24);
  const hash = await sha256Hex(token);
  await run(
    db,
    `UPDATE proposal_speakers SET manage_token_hash = ? WHERE proposal_id = ? AND user_id = ?`,
    [hash, proposalId, userId],
  );
  return token;
}

export interface ProposalSpeakerWithUser {
  speaker_id: string;
  user_id: string;
  role: string;
  status: string;
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
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
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
       u.headshot_r2_key,
       u.headshot_updated_at
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ?
     ORDER BY ps.created_at ASC`,
    [proposalId],
  );
}

export async function getProposalByManageToken(db: DatabaseLike, manageToken: string): Promise<ProposalRecord> {
  const hash = await sha256Hex(manageToken);
  const proposal = await first<ProposalRecord>(
    db,
    "SELECT * FROM session_proposals WHERE manage_token_hash = ?",
    [hash],
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
  },
): Promise<ProposalRecord> {
  const proposal = await getProposalByManageToken(db, payload.manageToken);

  if (proposal.status === "accepted" || proposal.status === "rejected") {
    throw new AppError(409, "PROPOSAL_FINALIZED", "Finalized proposals cannot be changed");
  }

  if (payload.action === "withdraw") {
    await run(
      db,
      "UPDATE session_proposals SET status = 'withdrawn', withdrawn_at = ?, updated_at = ? WHERE id = ?",
      [nowIso(), nowIso(), proposal.id],
    );

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
           updated_at = ?
       WHERE id = ?`,
      [payload.proposalType ?? null, payload.title ?? null, payload.abstract ?? null, payload.detailsJson ?? null, nowIso(), proposal.id],
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
    finalStatus: "accepted" | "rejected" | "needs_work";
    decisionNote?: string | null;
    minReviewsRequired: number;
  },
): Promise<{ reviewCount: number }> {
  const existingDecision = await first<{ id: string }>(
    db,
    "SELECT id FROM proposal_decisions WHERE proposal_id = ?",
    [payload.proposalId],
  );

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

  const proposal = await first<ProposalRecord>(db, "SELECT * FROM session_proposals WHERE id = ?", [payload.proposalId]);
  if (!proposal) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  }

  await run(
    db,
    `INSERT INTO proposal_decisions (
      id, proposal_id, decided_by_user_id, final_status,
      decision_note, min_reviews_required, review_count, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      payload.proposalId,
      payload.decidedByUserId,
      payload.finalStatus,
      payload.decisionNote ?? null,
      payload.minReviewsRequired,
      reviewCount,
      nowIso(),
    ],
  );

  const mappedStatus = payload.finalStatus === "needs_work" ? "needs_work" : payload.finalStatus;
  await run(
    db,
    "UPDATE session_proposals SET status = ?, updated_at = ? WHERE id = ?",
    [mappedStatus, nowIso(), payload.proposalId],
  );

  return { reviewCount };
}

export async function listProposalsForEvent(db: DatabaseLike, eventId: string): Promise<ProposalListRecord[]> {
  return all<ProposalListRecord>(
    db,
    `SELECT
       sp.*,
       u.email      AS proposer_email,
       u.first_name AS proposer_first_name,
       u.last_name  AS proposer_last_name,
       COALESCE(rv.review_count, 0) AS review_count,
       pd.final_status AS decision_status,
       pd.decision_note AS decision_note,
       pd.decided_at AS decision_decided_at
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     LEFT JOIN (
       SELECT proposal_id, COUNT(*) AS review_count
       FROM proposal_reviews
       GROUP BY proposal_id
     ) rv ON rv.proposal_id = sp.id
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE sp.event_id = ?
     ORDER BY sp.submitted_at DESC`,
    [eventId],
  );
}
