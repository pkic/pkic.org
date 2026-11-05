/** Ballot eligibility and atomic create-or-update submission. */
import { isVoteAcceptingBallots } from "./status";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso, nextIsoRevision } from "../../utils/time";
import { MOTION_CHOICES, eligibleCategoriesOf, getVoteRowOrThrow, type BallotChoice, type VoteRow } from "./shared";
import { exactVoteGroupMembership, voteParticipationGroupPredicate } from "./vote-access";
import { votingMembershipCategoryExistsSql } from "../membership/categories";
import { voteCategoryEligibilitySql, voteMemberNotExcludedSql } from "./electorate";
import { loadConsultationForm } from "./question";

export interface EligibleCapacity {
  identityId: string;
  memberId: string;
  membershipCategory: string;
}

export interface BallotActor {
  userId: string;
  identityId: string;
}

async function assertBallotChoiceValid(db: DatabaseLike, vote: VoteRow, choice: string): Promise<void> {
  if (vote.vote_type === "election") {
    const candidate = await first<{ id: string }>(
      db,
      `SELECT id FROM vote_candidates WHERE id = ? AND vote_id = ? AND eliminated_round IS NULL`,
      [choice, vote.id],
    );
    if (!candidate) throw new AppError(422, "INVALID_CHOICE", "choice must be a standing candidate id");
    return;
  }

  // A consultation that asks a form does not take a single choice at all —
  // its answers are a form submission, recorded through the consultation
  // response path rather than as a ballot.
  if (await loadConsultationForm(db, vote)) {
    throw new AppError(
      422,
      "VOTE_TAKES_A_FORM_RESPONSE",
      "This consultation is answered by submitting its form, not by casting a single choice",
    );
  }

  if (!MOTION_CHOICES.has(choice as BallotChoice)) {
    throw new AppError(422, "INVALID_CHOICE", "choice must be one of in_favor, opposed, abstain");
  }
}

export function assertVoteOpen(vote: VoteRow, now: string): void {
  if (!isVoteAcceptingBallots(vote, now)) {
    throw new AppError(409, "VOTE_NOT_OPEN", "This vote is not currently open for ballots");
  }
}

function categoryAllowed(vote: VoteRow, category: string): boolean {
  const restriction = eligibleCategoriesOf(vote);
  return !restriction || restriction.includes(category);
}

export async function resolvePerMemberCapacity(
  db: DatabaseLike,
  vote: VoteRow,
  member: BallotActor,
  requestedMemberId: string | null | undefined,
  throughGroupId?: string,
): Promise<EligibleCapacity> {
  if (!requestedMemberId) {
    throw new AppError(422, "MEMBER_ID_REQUIRED", "Select the represented Member whose ballot you are submitting");
  }
  const context = exactVoteGroupMembership(throughGroupId);
  const capacity = await first<{ identity_id: string; member_id: string; category_code: string }>(
    db,
    `SELECT membership.identity_id, membership.member_id, category.category_code
     FROM votes current_vote
     JOIN group_memberships membership ON membership.user_id = ?
     JOIN members represented_member ON represented_member.id = membership.member_id
     JOIN member_category_assignments category ON category.member_id = represented_member.id
     JOIN identities identity
       ON identity.id = membership.identity_id
      AND identity.user_id = membership.user_id
      AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL
      AND identity.blocked_at IS NULL
     JOIN users representative_user ON representative_user.id = membership.user_id AND representative_user.active = 1
     WHERE current_vote.id = ?
       AND ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
       ${context.sql}
       AND membership.identity_id = ?
       AND membership.member_id = ?
       AND membership.left_at IS NULL
       AND represented_member.status = 'active'
       AND represented_member.organization_id IS NOT NULL
       AND ${votingMembershipCategoryExistsSql("category.category_code")}
       AND ${voteMemberNotExcludedSql("current_vote", "represented_member.id")}
     LIMIT 1`,
    [member.userId, vote.id, ...context.bindings, member.identityId, requestedMemberId],
  );
  if (!capacity) {
    throw new AppError(403, "MEMBER_BALLOT_NOT_AUTHORIZED", "You cannot submit a ballot for this Member in this group");
  }
  if (!categoryAllowed(vote, capacity.category_code)) {
    throw new AppError(403, "CATEGORY_NOT_ELIGIBLE", "This Member's category is not eligible for the vote");
  }
  return {
    identityId: capacity.identity_id,
    memberId: capacity.member_id,
    membershipCategory: capacity.category_code,
  };
}

export async function resolvePerPersonCapacity(
  db: DatabaseLike,
  vote: VoteRow,
  member: BallotActor,
  throughGroupId?: string,
): Promise<EligibleCapacity> {
  const restriction = eligibleCategoriesOf(vote);
  const restrictionJson = restriction ? JSON.stringify(restriction) : null;
  const context = exactVoteGroupMembership(throughGroupId);
  const capacity = await first<{ identity_id: string; member_id: string; category_code: string }>(
    db,
    `SELECT membership.identity_id, membership.member_id, category.category_code
     FROM votes current_vote
     JOIN group_memberships membership ON membership.user_id = ?
     JOIN members represented_member ON represented_member.id = membership.member_id
     JOIN member_category_assignments category ON category.member_id = represented_member.id
     JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
     WHERE current_vote.id = ?
       AND ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
       ${context.sql}
       AND membership.identity_id = ?
       AND membership.left_at IS NULL
       AND represented_member.status = 'active'
       AND ${votingMembershipCategoryExistsSql("category.category_code")}
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM json_each(?) allowed WHERE allowed.value = category.category_code
       ))
     ORDER BY membership.joined_at ASC, membership.id ASC
     LIMIT 1`,
    [member.userId, vote.id, ...context.bindings, member.identityId, restrictionJson, restrictionJson],
  );
  if (!capacity) {
    throw new AppError(403, "PERSON_BALLOT_NOT_AUTHORIZED", "You are not eligible to vote through this group");
  }
  return {
    identityId: capacity.identity_id,
    memberId: capacity.member_id,
    membershipCategory: capacity.category_code,
  };
}

function preparePerMemberBallotUpsert(
  db: DatabaseLike,
  vote: VoteRow,
  member: BallotActor,
  capacity: EligibleCapacity,
  choice: string,
  ipHash: string | null,
  now: string,
  throughGroupId: string | undefined,
  replacesBallotCastAt: string | null,
): StatementLike {
  const context = exactVoteGroupMembership(throughGroupId);
  const replaceGuard = {
    sql: `AND ${RECORDED_MEMBER_BALLOT_AT_SQL} = ?`,
    bindings: [capacity.memberId, replacesBallotCastAt ?? ""],
  };
  return db
    .prepare(
      `INSERT INTO vote_ballots
         (id, vote_id, user_id, identity_id, member_id, choice, round, submitted_at, updated_at, ip_hash)
       SELECT ?, current_vote.id, ?, ?, ?, ?, current_vote.current_round, ?, ?, ?
       FROM votes current_vote
       WHERE current_vote.id = ?
         AND current_vote.electorate_mode = 'per_member'
         ${replaceGuard.sql}
         AND current_vote.closed_at IS NULL
         AND current_vote.cancelled_at IS NULL
         AND current_vote.current_round = ?
         AND current_vote.transition_revision = ?
         AND current_vote.transition_processing_token IS NULL
         AND current_vote.opens_at <= ?
         AND current_vote.closes_at > ?
         AND EXISTS (
           SELECT 1
           FROM group_memberships membership
           JOIN members represented_member ON represented_member.id = membership.member_id
           JOIN member_category_assignments category ON category.member_id = represented_member.id
           JOIN identities identity
             ON identity.id = membership.identity_id
            AND identity.user_id = membership.user_id
            AND identity.started_at IS NOT NULL
            AND identity.ended_at IS NULL
            AND identity.blocked_at IS NULL
           JOIN users representative_user
             ON representative_user.id = membership.user_id
            AND representative_user.active = 1
           WHERE ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
             AND membership.user_id = ?
             ${context.sql}
             AND membership.identity_id = ?
             AND membership.member_id = ?
             AND membership.left_at IS NULL
             AND represented_member.status = 'active'
             AND represented_member.organization_id IS NOT NULL
             AND category.category_code = ?
             AND ${voteCategoryEligibilitySql("current_vote", "category.category_code")}
             AND ${voteMemberNotExcludedSql("current_vote", "represented_member.id")}
         )
       ON CONFLICT(vote_id, member_id, round) WHERE member_id IS NOT NULL DO UPDATE SET
         user_id = excluded.user_id,
         identity_id = excluded.identity_id,
         choice = excluded.choice,
         updated_at = excluded.updated_at,
         ip_hash = excluded.ip_hash`,
    )
    .bind(
      uuid(),
      member.userId,
      capacity.identityId,
      capacity.memberId,
      choice,
      now,
      now,
      ipHash,
      vote.id,
      ...replaceGuard.bindings,
      vote.current_round,
      vote.transition_revision,
      now,
      now,
      member.userId,
      ...context.bindings,
      capacity.identityId,
      capacity.memberId,
      capacity.membershipCategory,
    );
}

function preparePerPersonBallotUpsert(
  db: DatabaseLike,
  vote: VoteRow,
  member: BallotActor,
  choice: string,
  ipHash: string | null,
  now: string,
  throughGroupId?: string,
): StatementLike {
  const context = exactVoteGroupMembership(throughGroupId);
  return db
    .prepare(
      `INSERT INTO vote_ballots
         (id, vote_id, user_id, identity_id, member_id, choice, round, submitted_at, updated_at, ip_hash)
       SELECT ?, current_vote.id, ?, ?, NULL, ?, current_vote.current_round, ?, ?, ?
       FROM votes current_vote
       WHERE current_vote.id = ?
         AND current_vote.electorate_mode = 'per_person'
         AND current_vote.closed_at IS NULL
         AND current_vote.cancelled_at IS NULL
         AND current_vote.current_round = ?
         AND current_vote.transition_revision = ?
         AND current_vote.transition_processing_token IS NULL
         AND current_vote.opens_at <= ?
         AND current_vote.closes_at > ?
         AND EXISTS (
           SELECT 1
           FROM group_memberships membership
           JOIN members represented_member ON represented_member.id = membership.member_id
           JOIN member_category_assignments category ON category.member_id = represented_member.id
           JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
           WHERE ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
             AND membership.user_id = ?
             ${context.sql}
             AND membership.identity_id = ?
             AND membership.left_at IS NULL
             AND represented_member.status = 'active'
             AND ${voteCategoryEligibilitySql("current_vote", "category.category_code")}
         )
       ON CONFLICT(vote_id, user_id, round) WHERE member_id IS NULL DO UPDATE SET
         identity_id = excluded.identity_id,
         choice = excluded.choice,
         updated_at = excluded.updated_at,
         ip_hash = excluded.ip_hash`,
    )
    .bind(
      uuid(),
      member.userId,
      member.identityId,
      choice,
      now,
      now,
      ipHash,
      vote.id,
      vote.current_round,
      vote.transition_revision,
      now,
      now,
      member.userId,
      ...context.bindings,
      member.identityId,
    );
}

/** The current round's Member ballot, by when it was last cast, or null when none is recorded. */
const RECORDED_MEMBER_BALLOT_AT_SQL = `COALESCE((
  SELECT existing.updated_at FROM vote_ballots existing
  WHERE existing.vote_id = current_vote.id AND existing.member_id = ? AND existing.round = current_vote.current_round
), '')`;

/**
 * Another representative may have cast or replaced the Member's ballot since
 * this one opened the vote. Replacing a ballot the person has not seen is refused.
 */
async function assertMemberBallotUnchanged(
  db: DatabaseLike,
  vote: VoteRow,
  memberId: string,
  replacesBallotCastAt: string | null,
): Promise<void> {
  const recorded = await first<{ cast_at: string }>(
    db,
    `SELECT ${RECORDED_MEMBER_BALLOT_AT_SQL} AS cast_at FROM votes current_vote WHERE current_vote.id = ?`,
    [memberId, vote.id],
  );
  if ((recorded?.cast_at ?? "") !== (replacesBallotCastAt ?? ""))
    throw new AppError(
      409,
      "BALLOT_CHANGED",
      "Your organization's ballot changed since you opened this vote. Reload to review the recorded ballot before replacing it.",
    );
}

export async function submitBallot(
  db: DatabaseLike,
  member: BallotActor,
  voteIdOrSlug: string,
  requestedMemberId: string | null | undefined,
  choice: string,
  ipHash: string | null,
  throughGroupId?: string,
  { replacesBallotCastAt }: { replacesBallotCastAt?: string | null } = {},
): Promise<void> {
  const vote = await getVoteRowOrThrow(db, voteIdOrSlug);
  let capacity: EligibleCapacity | null = null;
  if (vote.electorate_mode === "per_member") {
    capacity = await resolvePerMemberCapacity(db, vote, member, requestedMemberId, throughGroupId);
  } else {
    if (requestedMemberId != null) {
      throw new AppError(422, "MEMBER_ID_NOT_ALLOWED", "Per-person votes do not accept a Member selection");
    }
    await resolvePerPersonCapacity(db, vote, member, throughGroupId);
  }

  const now = nowIso();
  assertVoteOpen(vote, now);
  await assertBallotChoiceValid(db, vote, choice);

  // A Member's ballot is shared by its representatives. A submission that does not name the ballot it
  // replaces is taken to expect none, so it can cast the first ballot but never overwrite a recorded one.
  const replaces = capacity ? (replacesBallotCastAt ?? null) : undefined;
  // A replacement must advance the revision even if two submissions share a millisecond.
  const castAt = replaces ? nextIsoRevision(replaces) : now;

  const statement =
    vote.electorate_mode === "per_member"
      ? preparePerMemberBallotUpsert(
          db,
          vote,
          member,
          capacity!,
          choice,
          ipHash,
          castAt,
          throughGroupId,
          replaces ?? null,
        )
      : preparePerPersonBallotUpsert(db, vote, member, choice, ipHash, now, throughGroupId);

  const result = await statement.run();
  if (result.meta?.changes !== 1) {
    // Diagnose only a refused write; the atomic guard is authoritative and successful writes add no read.
    if (capacity) await assertMemberBallotUnchanged(db, vote, capacity.memberId, replaces ?? null);
    throw new AppError(409, "VOTE_CHANGED", "Voting eligibility or the voting window changed; reload and retry");
  }
}
