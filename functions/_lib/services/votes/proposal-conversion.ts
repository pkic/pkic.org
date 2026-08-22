import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { prepareAuditLog } from "../audit";
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareForumVoteDelegateNotificationIntents } from "./delegate-notification-intents";
import type { ProposalRow } from "./proposal-read";
import {
  getVoteRowOrThrow,
  toVoteSummary,
  uniqueSlug,
  type ThresholdType,
  type VoteStatus,
  type VoteSummary,
} from "./shared";
import { ACTIVE_VOTER_MEMBERSHIP_SQL, activeVoterMembershipBindings } from "./voter-eligibility";

export function prepareProposalTransitionGuard(db: DatabaseLike, proposal: ProposalRow): StatementLike {
  return db
    .prepare(
      `INSERT INTO vote_proposal_transition_guards (id, proposal_id, expected_revision)
       VALUES (?, ?, ?)`,
    )
    .bind(uuid(), proposal.id, proposal.transition_revision);
}

function proposalMemberGuard(proposal: ProposalRow, member: AuthMember): { sql: string; args: unknown[] } {
  return {
    sql: `${ACTIVE_VOTER_MEMBERSHIP_SQL}
          AND (
            ? <> 'working_group'
            OR EXISTS (
              SELECT 1
              FROM working_group_members wgm
              WHERE wgm.working_group_id = ? AND wgm.user_id = ? AND wgm.left_at IS NULL
            )
          )`,
    args: [...activeVoterMembershipBindings(member), proposal.scope_type, proposal.scope_id, member.userId],
  };
}

/**
 * Advances the proposal revision only if the endorsing member still holds the
 * working-group authority checked by the caller. The endorsement write later
 * in the same D1 batch is bound to that revision advance.
 */
function prepareEndorsementTransitionGuard(db: DatabaseLike, proposal: ProposalRow, member: AuthMember): StatementLike {
  const guard = proposalMemberGuard(proposal, member);
  return db
    .prepare(
      `INSERT INTO vote_proposal_transition_guards (id, proposal_id, expected_revision)
       SELECT ?, ?, ?
       WHERE ${guard.sql}`,
    )
    .bind(uuid(), proposal.id, proposal.transition_revision, ...guard.args);
}

export function isStaleProposalTransition(error: unknown): boolean {
  return error instanceof Error && error.message.includes("VOTE_PROPOSAL_CHANGED");
}

interface ConversionFields {
  id: string;
  slug: string;
  now: string;
  opensAt: string;
  closesAt: string;
  thresholdType: ThresholdType;
  status: VoteStatus;
}

async function buildConversionFields(db: DatabaseLike, proposal: ProposalRow): Promise<ConversionFields> {
  const now = nowIso();
  const opensAt = proposal.proposed_opens_at ?? now;
  const closesAt = proposal.proposed_closes_at ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: uuid(),
    slug: await uniqueSlug(db, proposal.title),
    now,
    opensAt,
    closesAt,
    thresholdType: proposal.vote_type === "election" ? "successive_elimination" : "simple_majority",
    status: new Date(opensAt).getTime() <= Date.now() ? "open" : "scheduled",
  };
}

function buildConversionStatements(
  db: DatabaseLike,
  proposal: ProposalRow,
  fields: ConversionFields,
  extraGuard?: { sql: string; args: unknown[] },
): [StatementLike, StatementLike] {
  const guardSql = extraGuard ? ` AND ${extraGuard.sql}` : "";
  const guardArgs = extraGuard?.args ?? [];
  return [
    db
      .prepare(
        `INSERT INTO votes
           (id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id,
            source_proposal_id, eligible_categories, threshold_type, opens_at, closes_at, current_round, status,
            result_json, visibility, public_detail_level, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, NULL, 'private', 'aggregate', ?, ?
         FROM vote_proposals
         WHERE id = ? AND status = 'open_for_endorsement'${guardSql}`,
      )
      .bind(
        fields.id,
        fields.slug,
        proposal.title,
        proposal.description,
        proposal.vote_type,
        proposal.scope_type,
        proposal.scope_id,
        proposal.proposed_by_user_id,
        proposal.id,
        proposal.eligible_categories,
        fields.thresholdType,
        fields.opensAt,
        fields.closesAt,
        fields.status,
        fields.now,
        fields.now,
        proposal.id,
        ...guardArgs,
      ),
    db
      .prepare(
        `UPDATE vote_proposals SET status = 'converted_to_vote', vote_id = ?, updated_at = ?
         WHERE id = ? AND status = 'open_for_endorsement'${guardSql}`,
      )
      .bind(fields.id, fields.now, proposal.id, ...guardArgs),
  ];
}

async function resolveLostRaceVote(db: DatabaseLike, proposalId: string): Promise<VoteSummary | null> {
  try {
    const current = await first<{ vote_id: string | null }>(db, "SELECT vote_id FROM vote_proposals WHERE id = ?", [
      proposalId,
    ]);
    return current?.vote_id ? toVoteSummary(await getVoteRowOrThrow(db, current.vote_id)) : null;
  } catch (error) {
    throw new AppError(
      500,
      "VOTE_CONVERSION_STATUS_UNKNOWN",
      "A concurrent vote-proposal conversion completed but its final state could not be confirmed.",
      { proposalId, cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function convertProposalToVoteWithGuard(
  db: DatabaseLike,
  proposal: ProposalRow,
  approvedByAdminId: string | undefined,
  member: AuthMember | null,
): Promise<VoteSummary> {
  const fields = await buildConversionFields(db, proposal);
  const memberGuard = member ? proposalMemberGuard(proposal, member) : undefined;
  const [voteInsert, updateStatus] = buildConversionStatements(db, proposal, fields, memberGuard);
  const statements = [
    member ? prepareEndorsementTransitionGuard(db, proposal, member) : prepareProposalTransitionGuard(db, proposal),
    voteInsert,
    updateStatus,
  ];
  if (approvedByAdminId) {
    statements.push(
      prepareAuditLog(
        db,
        "admin",
        approvedByAdminId,
        "vote_proposal_approved",
        "vote_proposal",
        proposal.id,
        { voteId: fields.id },
        fields.now,
      ),
    );
  }
  statements.push(prepareForumVoteDelegateNotificationIntents(db, fields.id, 1, fields.now));

  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (!isStaleProposalTransition(error)) throw error;
    const convertedVote = await resolveLostRaceVote(db, proposal.id);
    if (convertedVote) return convertedVote;
    throw new AppError(409, "PROPOSAL_NOT_CONVERTIBLE", "This proposal is no longer open for endorsement");
  }
  if ((results[1]?.meta?.changes ?? 0) === 0) {
    const convertedVote = await resolveLostRaceVote(db, proposal.id);
    if (convertedVote) return convertedVote;
    if (member) {
      throw new AppError(409, "MEMBERSHIP_CHANGED", "Voting eligibility changed; reload and retry");
    }
    throw new AppError(409, "PROPOSAL_NOT_CONVERTIBLE", "This proposal is no longer open for endorsement");
  }
  return toVoteSummary(await getVoteRowOrThrow(db, fields.id));
}

export function convertProposalToVote(
  db: DatabaseLike,
  proposal: ProposalRow,
  approvedByAdminId?: string,
): Promise<VoteSummary> {
  return convertProposalToVoteWithGuard(db, proposal, approvedByAdminId, null);
}

export function convertProposalToVoteForMember(
  db: DatabaseLike,
  proposal: ProposalRow,
  member: AuthMember,
): Promise<VoteSummary> {
  return convertProposalToVoteWithGuard(db, proposal, undefined, member);
}

export async function insertEndorsementAndMaybeConvert(
  db: DatabaseLike,
  proposal: ProposalRow,
  member: AuthMember,
  minEndorsersRequired: number,
): Promise<VoteSummary | null> {
  const fields = await buildConversionFields(db, proposal);
  const endorsementId = uuid();
  const [voteInsert, updateStatus] = buildConversionStatements(db, proposal, fields, {
    sql: `EXISTS (SELECT 1 FROM vote_proposal_endorsements WHERE id = ? AND proposal_id = ?)
          AND (SELECT COUNT(*) FROM vote_proposal_endorsements WHERE proposal_id = ?) >= ?`,
    args: [endorsementId, proposal.id, proposal.id, minEndorsersRequired],
  });
  const results = await db.batch([
    prepareEndorsementTransitionGuard(db, proposal, member),
    db
      .prepare(
        `INSERT INTO vote_proposal_endorsements (id, proposal_id, endorser_user_id, endorsed_at)
         SELECT ?, ?, ?, ?
         FROM vote_proposals vp
         WHERE vp.id = ? AND vp.transition_revision = ?
           AND ${ACTIVE_VOTER_MEMBERSHIP_SQL}
           AND (
             vp.scope_type <> 'working_group'
             OR EXISTS (
               SELECT 1
               FROM working_group_members wgm
               WHERE wgm.working_group_id = vp.scope_id
                 AND wgm.user_id = ?
                 AND wgm.left_at IS NULL
             )
           )`,
      )
      .bind(
        endorsementId,
        proposal.id,
        member.userId,
        nowIso(),
        proposal.id,
        proposal.transition_revision + 1,
        ...activeVoterMembershipBindings(member),
        member.userId,
      ),
    voteInsert,
    updateStatus,
    prepareForumVoteDelegateNotificationIntents(db, fields.id, 1, fields.now),
  ]);
  if ((results[1]?.meta?.changes ?? 0) !== 1) {
    throw new AppError(409, "MEMBERSHIP_CHANGED", "Voting eligibility changed; reload and retry");
  }
  if ((results[2]?.meta?.changes ?? 0) > 0) {
    return toVoteSummary(await getVoteRowOrThrow(db, fields.id));
  }
  return resolveLostRaceVote(db, proposal.id);
}
