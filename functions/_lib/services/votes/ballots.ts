/** Ballot eligibility and atomic create-or-update submission. */
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { MOTION_CHOICES, eligibleCategoriesOf, getVoteRowOrThrow, type BallotChoice, type VoteRow } from "./shared";
import { voteParticipationGroupPredicate } from "./vote-access";

interface EligibleCapacity {
  memberId: string;
  membershipCategory: string;
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

function assertVoteOpen(vote: VoteRow, now: string): void {
  if (vote.status !== "open" || vote.opens_at > now || vote.closes_at <= now) {
    throw new AppError(409, "VOTE_NOT_OPEN", "This vote is not currently open for ballots");
  }
}

function categoryAllowed(vote: VoteRow, category: string): boolean {
  const restriction = eligibleCategoriesOf(vote);
  return !restriction || restriction.includes(category);
}

async function resolvePerMemberCapacity(
  db: DatabaseLike,
  vote: VoteRow,
  member: AuthMember,
  requestedMemberId: string | null | undefined,
): Promise<EligibleCapacity> {
  if (!requestedMemberId) {
    throw new AppError(422, "MEMBER_ID_REQUIRED", "Select the represented Member whose ballot you are submitting");
  }
  const capacity = await first<{ member_id: string; category_code: string }>(
    db,
    `SELECT membership.member_id, category.category_code
     FROM votes current_vote
     JOIN group_memberships membership ON membership.user_id = ?
     JOIN members represented_member ON represented_member.id = membership.member_id
     JOIN member_category_assignments category ON category.member_id = represented_member.id
     JOIN organization_representatives representative
       ON representative.member_id = represented_member.id
      AND representative.user_id = membership.user_id
      AND representative.left_at IS NULL
      AND representative.blocked_at IS NULL
     JOIN users representative_user ON representative_user.id = membership.user_id AND representative_user.active = 1
     WHERE current_vote.id = ?
       AND ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
       AND membership.member_id = ?
       AND membership.left_at IS NULL
       AND represented_member.status = 'active'
       AND represented_member.organization_id IS NOT NULL
     LIMIT 1`,
    [member.userId, vote.id, requestedMemberId],
  );
  if (!capacity) {
    throw new AppError(403, "MEMBER_BALLOT_NOT_AUTHORIZED", "You cannot submit a ballot for this Member in this group");
  }
  if (!categoryAllowed(vote, capacity.category_code)) {
    throw new AppError(403, "CATEGORY_NOT_ELIGIBLE", "This Member's category is not eligible for the vote");
  }
  return { memberId: capacity.member_id, membershipCategory: capacity.category_code };
}

async function resolvePerPersonCapacity(
  db: DatabaseLike,
  vote: VoteRow,
  member: AuthMember,
): Promise<EligibleCapacity> {
  const restriction = eligibleCategoriesOf(vote);
  const restrictionJson = restriction ? JSON.stringify(restriction) : null;
  const capacity = await first<{ member_id: string; category_code: string }>(
    db,
    `SELECT membership.member_id, category.category_code
     FROM votes current_vote
     JOIN group_memberships membership ON membership.user_id = ?
     JOIN members represented_member ON represented_member.id = membership.member_id
     JOIN member_category_assignments category ON category.member_id = represented_member.id
     JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
     WHERE current_vote.id = ?
       AND ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
       AND membership.left_at IS NULL
       AND represented_member.status = 'active'
       AND category.category_code IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM json_each(?) allowed WHERE allowed.value = category.category_code
       ))
     ORDER BY membership.joined_at ASC, membership.id ASC
     LIMIT 1`,
    [member.userId, vote.id, restrictionJson, restrictionJson],
  );
  if (!capacity) {
    throw new AppError(403, "PERSON_BALLOT_NOT_AUTHORIZED", "You are not eligible to vote through this group");
  }
  return { memberId: capacity.member_id, membershipCategory: capacity.category_code };
}

function preparePerMemberBallotUpsert(
  db: DatabaseLike,
  vote: VoteRow,
  member: AuthMember,
  capacity: EligibleCapacity,
  choice: string,
  ipHash: string | null,
  now: string,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO vote_ballots
         (id, vote_id, user_id, member_id, choice, round, submitted_at, updated_at, ip_hash)
       SELECT ?, current_vote.id, ?, ?, ?, current_vote.current_round, ?, ?, ?
       FROM votes current_vote
       WHERE current_vote.id = ?
         AND current_vote.electorate_mode = 'per_member'
         AND current_vote.status = 'open'
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
           JOIN organization_representatives representative
             ON representative.member_id = represented_member.id
            AND representative.user_id = membership.user_id
            AND representative.left_at IS NULL
            AND representative.blocked_at IS NULL
           JOIN users representative_user
             ON representative_user.id = membership.user_id
            AND representative_user.active = 1
           WHERE ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
             AND membership.user_id = ?
             AND membership.member_id = ?
             AND membership.left_at IS NULL
             AND represented_member.status = 'active'
             AND represented_member.organization_id IS NOT NULL
             AND category.category_code = ?
             AND (
               current_vote.eligible_categories IS NULL
               OR EXISTS (
                 SELECT 1 FROM json_each(current_vote.eligible_categories) allowed
                 WHERE allowed.value = category.category_code
               )
             )
         )
       ON CONFLICT(vote_id, member_id, round) WHERE member_id IS NOT NULL DO UPDATE SET
         user_id = excluded.user_id,
         choice = excluded.choice,
         updated_at = excluded.updated_at,
         ip_hash = excluded.ip_hash`,
    )
    .bind(
      uuid(),
      member.userId,
      capacity.memberId,
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
      capacity.memberId,
      capacity.membershipCategory,
    );
}

function preparePerPersonBallotUpsert(
  db: DatabaseLike,
  vote: VoteRow,
  member: AuthMember,
  choice: string,
  ipHash: string | null,
  now: string,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO vote_ballots
         (id, vote_id, user_id, member_id, choice, round, submitted_at, updated_at, ip_hash)
       SELECT ?, current_vote.id, ?, NULL, ?, current_vote.current_round, ?, ?, ?
       FROM votes current_vote
       WHERE current_vote.id = ?
         AND current_vote.electorate_mode = 'per_person'
         AND current_vote.status = 'open'
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
             AND membership.left_at IS NULL
             AND represented_member.status = 'active'
             AND category.category_code IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')
             AND (
               current_vote.eligible_categories IS NULL
               OR EXISTS (
                 SELECT 1 FROM json_each(current_vote.eligible_categories) allowed
                 WHERE allowed.value = category.category_code
               )
             )
         )
       ON CONFLICT(vote_id, user_id, round) WHERE member_id IS NULL DO UPDATE SET
         choice = excluded.choice,
         updated_at = excluded.updated_at,
         ip_hash = excluded.ip_hash`,
    )
    .bind(
      uuid(),
      member.userId,
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
    );
}

export async function submitBallot(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
  requestedMemberId: string | null | undefined,
  choice: string,
  ipHash: string | null,
): Promise<void> {
  const vote = await getVoteRowOrThrow(db, voteIdOrSlug);
  let capacity: EligibleCapacity | null = null;
  if (vote.electorate_mode === "per_member") {
    capacity = await resolvePerMemberCapacity(db, vote, member, requestedMemberId);
  } else {
    if (requestedMemberId != null) {
      throw new AppError(422, "MEMBER_ID_NOT_ALLOWED", "Per-person votes do not accept a Member selection");
    }
    await resolvePerPersonCapacity(db, vote, member);
  }

  const now = nowIso();
  assertVoteOpen(vote, now);
  await assertBallotChoiceValid(db, vote, choice);

  const statement =
    vote.electorate_mode === "per_member"
      ? preparePerMemberBallotUpsert(db, vote, member, capacity!, choice, ipHash, now)
      : preparePerPersonBallotUpsert(db, vote, member, choice, ipHash, now);

  const result = await statement.run();
  if (result.meta?.changes !== 1) {
    throw new AppError(409, "VOTE_CHANGED", "Voting eligibility or the voting window changed; reload and retry");
  }
}
