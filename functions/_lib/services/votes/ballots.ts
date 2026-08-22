/**
 * Ballot eligibility and submission. Split out of votes.ts.
 */
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { resolveRepresentativeRoleHolders } from "../membership/representative-roles";
import {
  getVoteRowOrThrow,
  eligibleCategoriesOf,
  assertVotingCategory,
  MOTION_CHOICES,
  type VoteRow,
  type BallotChoice,
} from "./shared";
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";

/** role-voting_delegate (user_roles, context_type='organization') falls back to role-primary_contact when unset. */
export async function resolveVotingDelegateUserId(db: DatabaseLike, organizationId: string): Promise<string | null> {
  const org = await first<{ member_id: string }>(db, `SELECT id AS member_id FROM members WHERE organization_id = ?`, [
    organizationId,
  ]);
  if (!org) return null;
  const holders = await resolveRepresentativeRoleHolders(db, org.member_id);
  return holders.votingDelegateUserId ?? holders.primaryContactUserId;
}

async function assertBallotChoiceValid(db: DatabaseLike, vote: VoteRow, choice: string): Promise<void> {
  if (vote.vote_type === "election") {
    const candidate = await first<{ id: string }>(
      db,
      `SELECT id FROM vote_candidates WHERE id = ? AND vote_id = ? AND eliminated_round IS NULL`,
      [choice, vote.id],
    );
    if (!candidate) throw new AppError(422, "INVALID_CHOICE", "choice must be a standing candidate id");
  } else if (!MOTION_CHOICES.has(choice as BallotChoice)) {
    throw new AppError(422, "INVALID_CHOICE", "choice must be one of in_favor, opposed, abstain");
  }
}

function assertEligibleCategory(vote: VoteRow, member: AuthMember): void {
  const restriction = eligibleCategoriesOf(vote);
  if (restriction && !restriction.includes(member.membershipCategory)) {
    throw new AppError(403, "CATEGORY_NOT_ELIGIBLE", "Your membership category is not eligible to vote in this vote");
  }
}

function assertVoteOpen(vote: VoteRow, now: string): void {
  if (vote.status !== "open" || vote.opens_at > now || vote.closes_at <= now) {
    throw new AppError(409, "VOTE_NOT_OPEN", "This vote is not currently open for ballots");
  }
}

function isBallotUniquenessError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: vote_ballots");
}

async function executeGuardedBallotInsert(statement: StatementLike): Promise<void> {
  try {
    const result = await statement.run();
    if (result.meta?.changes !== 1) {
      throw new AppError(409, "VOTE_CHANGED", "The vote round or voting window changed; reload and retry");
    }
  } catch (error) {
    if (isBallotUniquenessError(error)) {
      throw new AppError(409, "ALREADY_VOTED", "You have already cast a ballot for this round");
    }
    throw error;
  }
}

export async function submitBallot(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
  choice: string,
  ipHash: string | null,
): Promise<void> {
  const vote = await getVoteRowOrThrow(db, voteIdOrSlug);
  const now = nowIso();
  assertVoteOpen(vote, now);
  await assertVotingCategory(member);
  assertEligibleCategory(vote, member);
  await assertBallotChoiceValid(db, vote, choice);

  if (vote.scope_type === "forum") {
    if (!member.organizationId) {
      throw new AppError(403, "NO_ORGANIZATION", "Only member organizations may cast a forum-level ballot");
    }
    const delegateId = await resolveVotingDelegateUserId(db, member.organizationId);
    if (delegateId !== member.userId) {
      throw new AppError(403, "NOT_VOTING_DELEGATE", "Only your organization's voting delegate may cast this ballot");
    }
    const existing = await first<{ id: string }>(
      db,
      `SELECT id FROM vote_ballots WHERE vote_id = ? AND organization_id = ? AND round = ?`,
      [vote.id, member.organizationId, vote.current_round],
    );
    if (existing)
      throw new AppError(409, "ALREADY_VOTED", "Your organization has already cast a ballot for this round");
    await executeGuardedBallotInsert(
      db
        .prepare(
          `INSERT INTO vote_ballots
             (id, vote_id, user_id, organization_id, choice, round, submitted_at, ip_hash)
           SELECT ?, v.id, ?, ?, ?, v.current_round, ?, ?
           FROM votes v
           WHERE v.id = ?
             AND v.status = 'open'
             AND v.current_round = ?
             AND v.transition_revision = ?
             AND v.transition_processing_token IS NULL
             AND v.opens_at <= ?
             AND v.closes_at > ?`,
        )
        .bind(
          uuid(),
          member.userId,
          member.organizationId,
          choice,
          now,
          ipHash,
          vote.id,
          vote.current_round,
          vote.transition_revision,
          now,
          now,
        ),
    );
    return;
  }

  // working_group scope: one ballot per person, must be an active WG member
  const membership = await first<{ id: string }>(
    db,
    `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
    [vote.scope_id, member.userId],
  );
  if (!membership) {
    throw new AppError(403, "NOT_A_WG_MEMBER", "Only members of this working group may cast a ballot");
  }
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM vote_ballots WHERE vote_id = ? AND user_id = ? AND round = ? AND organization_id IS NULL`,
    [vote.id, member.userId, vote.current_round],
  );
  if (existing) throw new AppError(409, "ALREADY_VOTED", "You have already cast a ballot for this round");
  await executeGuardedBallotInsert(
    db
      .prepare(
        `INSERT INTO vote_ballots
           (id, vote_id, user_id, organization_id, choice, round, submitted_at, ip_hash)
         SELECT ?, v.id, ?, NULL, ?, v.current_round, ?, ?
         FROM votes v
         WHERE v.id = ?
           AND v.status = 'open'
           AND v.current_round = ?
           AND v.transition_revision = ?
           AND v.transition_processing_token IS NULL
           AND v.opens_at <= ?
           AND v.closes_at > ?`,
      )
      .bind(
        uuid(),
        member.userId,
        choice,
        now,
        ipHash,
        vote.id,
        vote.current_round,
        vote.transition_revision,
        now,
        now,
      ),
  );
}
