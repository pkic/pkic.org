/** Ballot eligibility and atomic create-or-update submission. */
import { sqlValue, type SqlId } from "../../db/sql-value";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { isVoteAcceptingBallots, type VoteLifecycleFacts } from "./status";
import { batchFirst } from "../../db/pagination";
import type { D1StatementResult } from "../../types";
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

/** Choice validity remains inside the write, including candidate elimination and form-response routing. */
export function ballotChoiceEvidence(choice: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 WHERE (current_vote.vote_type='election' AND EXISTS(
      SELECT 1 FROM vote_candidates candidate WHERE candidate.vote_id=current_vote.id AND candidate.id=? AND candidate.eliminated_round IS NULL
    )) OR (current_vote.vote_type<>'election' AND current_vote.question_form_id IS NULL AND ? IN (SELECT value FROM json_each(?)))`,
    bindings: [choice, choice, JSON.stringify([...MOTION_CHOICES])],
  };
}

interface PreparedBallotActor {
  userId: string;
  identityId: SqlId;
}
interface PreparedBallotVote {
  id: SqlId;
  current_round?: number;
  transition_revision?: number;
}
interface PreparedBallotCapacity {
  memberId: string;
  membershipCategory?: string;
}

export function validateBallotChoice(
  vote: Pick<VoteRow, "vote_type">,
  choice: string,
  standingCandidate: boolean,
  takesForm: boolean,
): void {
  if (vote.vote_type === "election") {
    if (!standingCandidate) throw new AppError(422, "INVALID_CHOICE", "choice must be a standing candidate id");
  } else {
    if (takesForm)
      throw new AppError(
        422,
        "VOTE_TAKES_A_FORM_RESPONSE",
        "This consultation is answered by submitting its form, not by casting a single choice",
      );
    if (!MOTION_CHOICES.has(choice as BallotChoice))
      throw new AppError(422, "INVALID_CHOICE", "choice must be one of in_favor, opposed, abstain");
  }
}

async function assertBallotChoiceValid(db: DatabaseLike, vote: VoteRow, choice: string): Promise<void> {
  const candidate =
    vote.vote_type === "election"
      ? await first<{ id: string }>(
          db,
          `SELECT id FROM vote_candidates WHERE id=? AND vote_id=? AND eliminated_round IS NULL`,
          [choice, vote.id],
        )
      : null;
  const form = vote.vote_type === "election" ? null : await loadConsultationForm(db, vote);
  validateBallotChoice(vote, choice, candidate !== null, form !== null);
}

export function assertVoteOpen(vote: VoteLifecycleFacts, now: string): void {
  if (!isVoteAcceptingBallots(vote, now)) {
    throw new AppError(409, "VOTE_NOT_OPEN", "This vote is not currently open for ballots");
  }
}

function categoryAllowed(vote: Pick<VoteRow, "eligible_categories">, category: string): boolean {
  const restriction = eligibleCategoriesOf(vote);
  return !restriction || restriction.includes(category);
}

export function preparePerMemberCapacity(
  db: DatabaseLike,
  voteId: SqlId,
  member: PreparedBallotActor,
  requestedMemberId: string | null | undefined,
  throughGroupId?: SqlId,
) {
  const selectedVote = sqlValue(voteId);
  const identity = sqlValue(member.identityId);
  const context = exactVoteGroupMembership(throughGroupId);
  const statement = db
    .prepare(
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
     WHERE current_vote.id = ${selectedVote.sql}
       AND ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
       ${context.sql}
       AND membership.identity_id = ${identity.sql}
       AND membership.member_id = ?
       AND membership.left_at IS NULL
       AND represented_member.status = 'active'
       AND represented_member.organization_id IS NOT NULL
       AND ${votingMembershipCategoryExistsSql("category.category_code")}
       AND ${voteMemberNotExcludedSql("current_vote", "represented_member.id")}
     LIMIT 1`,
    )
    .bind(
      member.userId,
      ...selectedVote.bindings,
      ...context.bindings,
      ...identity.bindings,
      requestedMemberId ?? null,
    );
  return {
    statement,
    decode(result: D1StatementResult, vote: Pick<VoteRow, "eligible_categories">): EligibleCapacity {
      const capacity = batchFirst<{ identity_id: string; member_id: string; category_code: string }>(result);

      if (!requestedMemberId)
        throw new AppError(422, "MEMBER_ID_REQUIRED", "Select the represented Member whose ballot you are submitting");
      if (!capacity) {
        throw new AppError(
          403,
          "MEMBER_BALLOT_NOT_AUTHORIZED",
          "You cannot submit a ballot for this Member in this group",
        );
      }
      if (!categoryAllowed(vote, capacity.category_code)) {
        throw new AppError(403, "CATEGORY_NOT_ELIGIBLE", "This Member's category is not eligible for the vote");
      }
      return {
        identityId: capacity.identity_id,
        memberId: capacity.member_id,
        membershipCategory: capacity.category_code,
      };
    },
  };
}

export async function resolvePerMemberCapacity(
  db: DatabaseLike,
  vote: VoteRow,
  member: BallotActor,
  requestedMemberId: string | null | undefined,
  throughGroupId?: string,
): Promise<EligibleCapacity> {
  const read = preparePerMemberCapacity(db, vote.id, member, requestedMemberId, throughGroupId);
  return read.decode((await db.batch([read.statement]))[0], vote);
}

export function preparePerPersonCapacity(
  db: DatabaseLike,
  voteId: SqlId,
  member: PreparedBallotActor,
  throughGroupId?: SqlId,
) {
  const selectedVote = sqlValue(voteId);
  const identity = sqlValue(member.identityId);
  const context = exactVoteGroupMembership(throughGroupId);
  const statement = db
    .prepare(
      `SELECT membership.identity_id, membership.member_id, category.category_code
     FROM votes current_vote
     JOIN group_memberships membership ON membership.user_id = ?
     JOIN members represented_member ON represented_member.id = membership.member_id
     JOIN member_category_assignments category ON category.member_id = represented_member.id
     JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
     WHERE current_vote.id = ${selectedVote.sql}
       AND ${voteParticipationGroupPredicate("current_vote", "membership.group_id")}
       ${context.sql}
       AND membership.identity_id = ${identity.sql}
       AND membership.left_at IS NULL
       AND represented_member.status = 'active'
       AND ${voteCategoryEligibilitySql("current_vote", "category.category_code")}
     ORDER BY membership.joined_at ASC, membership.id ASC
     LIMIT 1`,
    )
    .bind(member.userId, ...selectedVote.bindings, ...context.bindings, ...identity.bindings);
  return {
    statement,
    decode(result: D1StatementResult): EligibleCapacity {
      const capacity = batchFirst<{ identity_id: string; member_id: string; category_code: string }>(result);

      if (!capacity) {
        throw new AppError(403, "PERSON_BALLOT_NOT_AUTHORIZED", "You are not eligible to vote through this group");
      }
      return {
        identityId: capacity.identity_id,
        memberId: capacity.member_id,
        membershipCategory: capacity.category_code,
      };
    },
  };
}

export async function resolvePerPersonCapacity(
  db: DatabaseLike,
  vote: VoteRow,
  member: BallotActor,
  throughGroupId?: string,
): Promise<EligibleCapacity> {
  const read = preparePerPersonCapacity(db, vote.id, member, throughGroupId);
  return read.decode((await db.batch([read.statement]))[0]);
}

export function preparePerMemberBallotUpsert(
  db: DatabaseLike,
  vote: PreparedBallotVote,
  member: PreparedBallotActor,
  capacity: PreparedBallotCapacity,
  choice: string,
  ipHash: string | null,
  now: string,
  throughGroupId: SqlId | undefined,
  replacesBallotCastAt: string | null,
  options: { authorization?: AuthorizationEvidence; windowAt?: string } = {},
): StatementLike {
  const { authorization, windowAt = now } = options;
  const selectedVote = sqlValue(vote.id);
  const identity = sqlValue(member.identityId);
  const validChoice = ballotChoiceEvidence(choice);
  const context = exactVoteGroupMembership(throughGroupId);
  const replaceGuard = {
    sql: `AND ${RECORDED_MEMBER_BALLOT_AT_SQL} = ?`,
    bindings: [capacity.memberId, replacesBallotCastAt ?? ""],
  };
  return db
    .prepare(
      `${authorization ? `WITH ballot_authority AS MATERIALIZED (${authorization.sql}) ` : ""}INSERT INTO vote_ballots
         (id, vote_id, user_id, identity_id, member_id, choice, round, submitted_at, updated_at, ip_hash)
       SELECT ?, current_vote.id, ?, ${identity.sql}, ?, ?, current_vote.current_round, ?, ?, ?
       FROM votes current_vote
       WHERE current_vote.id = ${selectedVote.sql}
         AND current_vote.electorate_mode = 'per_member'
         ${replaceGuard.sql}
         AND current_vote.closed_at IS NULL
         AND current_vote.cancelled_at IS NULL
         ${vote.current_round === undefined ? "" : "AND current_vote.current_round = ?"}
         ${vote.transition_revision === undefined ? "" : "AND current_vote.transition_revision = ?"}
         AND current_vote.transition_processing_token IS NULL
         AND EXISTS (${validChoice.sql})
         ${authorization ? "AND EXISTS (SELECT 1 FROM ballot_authority)" : ""}
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
             AND membership.identity_id = ${identity.sql}
             AND membership.member_id = ?
             AND membership.left_at IS NULL
             AND represented_member.status = 'active'
             AND represented_member.organization_id IS NOT NULL
             ${capacity.membershipCategory === undefined ? "" : "AND category.category_code = ?"}
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
      ...(authorization?.bindings ?? []),
      uuid(),
      member.userId,
      ...identity.bindings,
      capacity.memberId,
      choice,
      now,
      now,
      ipHash,
      ...selectedVote.bindings,
      ...replaceGuard.bindings,
      ...(vote.current_round === undefined ? [] : [vote.current_round]),
      ...(vote.transition_revision === undefined ? [] : [vote.transition_revision]),
      ...validChoice.bindings,
      windowAt,
      windowAt,
      member.userId,
      ...context.bindings,
      ...identity.bindings,
      capacity.memberId,
      ...(capacity.membershipCategory === undefined ? [] : [capacity.membershipCategory]),
    );
}

export function preparePerPersonBallotUpsert(
  db: DatabaseLike,
  vote: PreparedBallotVote,
  member: PreparedBallotActor,
  choice: string,
  ipHash: string | null,
  now: string,
  throughGroupId?: SqlId,
  authorization?: AuthorizationEvidence,
): StatementLike {
  const selectedVote = sqlValue(vote.id);
  const identity = sqlValue(member.identityId);
  const validChoice = ballotChoiceEvidence(choice);
  const context = exactVoteGroupMembership(throughGroupId);
  return db
    .prepare(
      `${authorization ? `WITH ballot_authority AS MATERIALIZED (${authorization.sql}) ` : ""}INSERT INTO vote_ballots
         (id, vote_id, user_id, identity_id, member_id, choice, round, submitted_at, updated_at, ip_hash)
       SELECT ?, current_vote.id, ?, ${identity.sql}, NULL, ?, current_vote.current_round, ?, ?, ?
       FROM votes current_vote
       WHERE current_vote.id = ${selectedVote.sql}
         AND current_vote.electorate_mode = 'per_person'
         AND current_vote.closed_at IS NULL
         AND current_vote.cancelled_at IS NULL
         ${vote.current_round === undefined ? "" : "AND current_vote.current_round = ?"}
         ${vote.transition_revision === undefined ? "" : "AND current_vote.transition_revision = ?"}
         AND current_vote.transition_processing_token IS NULL
         AND EXISTS (${validChoice.sql})
         ${authorization ? "AND EXISTS (SELECT 1 FROM ballot_authority)" : ""}
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
             AND membership.identity_id = ${identity.sql}
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
      ...(authorization?.bindings ?? []),
      uuid(),
      member.userId,
      ...identity.bindings,
      choice,
      now,
      now,
      ipHash,
      ...selectedVote.bindings,
      ...(vote.current_round === undefined ? [] : [vote.current_round]),
      ...(vote.transition_revision === undefined ? [] : [vote.transition_revision]),
      ...validChoice.bindings,
      now,
      now,
      member.userId,
      ...context.bindings,
      ...identity.bindings,
    );
}

/** The current round's Member ballot, by when it was last cast, or null when none is recorded. */
export const RECORDED_MEMBER_BALLOT_AT_SQL = `COALESCE((
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
  assertRecordedMemberBallotUnchanged(recorded?.cast_at ?? "", replacesBallotCastAt);
}

export function assertRecordedMemberBallotUnchanged(castAt: string, replacesBallotCastAt: string | null): void {
  if (castAt !== (replacesBallotCastAt ?? ""))
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
          { windowAt: now },
        )
      : preparePerPersonBallotUpsert(db, vote, member, choice, ipHash, now, throughGroupId);

  const result = await statement.run();
  if (result.meta?.changes !== 1) {
    // Diagnose only a refused write; the atomic guard is authoritative and successful writes add no read.
    if (capacity) await assertMemberBallotUnchanged(db, vote, capacity.memberId, replaces ?? null);
    throw new AppError(409, "VOTE_CHANGED", "Voting eligibility or the voting window changed; reload and retry");
  }
}
