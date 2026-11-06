/** Atomic ballot request: canonical live authority, refusal snapshot, and guarded write in one D1 batch. */
import type { z } from "zod";
import type { submitBallotSchema } from "../../../../assets/shared/schemas/votes";
import { prepareGroupResourceRequest } from "../groups/resource-request";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike, Env } from "../../types";
import { AppError } from "../../errors";
import { nowIso, nextIsoRevision } from "../../utils/time";
import type { VoteRow } from "./shared";
import {
  assertVoteOpen,
  validateBallotChoice,
  preparePerMemberCapacity,
  preparePerPersonCapacity,
  preparePerMemberBallotUpsert,
  preparePerPersonBallotUpsert,
  assertRecordedMemberBallotUnchanged,
} from "./ballots";
import { assertConsultationFormUsable } from "./question";

interface SubmissionSnapshot extends Pick<
  VoteRow,
  | "id"
  | "vote_type"
  | "electorate_mode"
  | "eligible_categories"
  | "question_form_id"
  | "opens_at"
  | "closes_at"
  | "opened_at"
  | "closed_at"
  | "cancelled_at"
> {
  standing_candidate: number;
  recorded_at: string | null;
  form_status: string | null;
  form_field_count: number;
}

export async function submitGroupBallotRequest(
  db: DatabaseLike,
  request: Request,
  env: Env,
  groupReference: string,
  voteId: string,
  input: z.infer<typeof submitBallotSchema>,
  ipHash: string | null,
): Promise<void> {
  const auth = await prepareGroupResourceRequest(db, request, env, groupReference);
  const voteSelection = { sql: "SELECT id FROM votes WHERE id=? OR slug=?", bindings: [voteId, voteId] };
  const actor = { userId: auth.userId, identityId: auth.identitySelection ?? { sql: "SELECT NULL", bindings: [] } };
  const member = preparePerMemberCapacity(db, voteSelection, actor, input.memberId, auth.group);
  const person = preparePerPersonCapacity(db, voteSelection, actor, auth.group);
  const now = nowIso();
  const castAt = input.replacesBallotCastAt ? nextIsoRevision(input.replacesBallotCastAt) : now;
  // A caller cannot turn a per-person ballot into a Member ballot, or vice versa.
  const authorization = {
    sql: `SELECT 1 WHERE EXISTS(${auth.participationEvidence.sql}) AND
      ((current_vote.electorate_mode='per_member' AND ? IS NOT NULL) OR
       (current_vote.electorate_mode='per_person' AND ? IS NULL))`,
    bindings: [...auth.participationEvidence.bindings, input.memberId ?? null, input.memberId ?? null],
  };
  const statements = [
    ...auth.statements,
    db
      .prepare(
        `SELECT votes.id, votes.vote_type, votes.electorate_mode, votes.eligible_categories,
       votes.question_form_id, votes.opens_at, votes.closes_at, votes.opened_at, votes.closed_at, votes.cancelled_at,
       EXISTS(SELECT 1 FROM vote_candidates candidate WHERE candidate.vote_id=votes.id AND candidate.id=? AND candidate.eliminated_round IS NULL) AS standing_candidate,
       (SELECT updated_at FROM vote_ballots ballot WHERE ballot.vote_id=votes.id AND ballot.member_id=? AND ballot.round=votes.current_round) AS recorded_at,
       (SELECT status FROM forms WHERE id=votes.question_form_id) AS form_status,
       (SELECT COUNT(*) FROM form_fields WHERE form_id=votes.question_form_id AND archived_at IS NULL) AS form_field_count
       FROM votes WHERE id=? OR slug=?`,
      )
      .bind(input.choice, input.memberId ?? null, voteId, voteId),
    member.statement,
    person.statement,
    preparePerMemberBallotUpsert(
      db,
      { id: voteSelection },
      actor,
      { memberId: input.memberId ?? "" },
      input.choice,
      ipHash,
      castAt,
      auth.group,
      input.replacesBallotCastAt ?? null,
      { authorization, windowAt: now },
    ),
    preparePerPersonBallotUpsert(
      db,
      { id: voteSelection },
      actor,
      input.choice,
      ipHash,
      now,
      auth.group,
      authorization,
    ),
  ];
  const results = await db.batch(statements);
  const context = await auth.decode(results.slice(0, auth.statements.length));
  if (!context.member)
    throw new AppError(403, "GROUP_PARTICIPATION_REQUIRED", "An active membership capacity is required");
  const [snapshot, memberResult, personResult, memberWrite, personWrite] = results.slice(auth.statements.length);
  const vote = batchFirst<SubmissionSnapshot>(snapshot);
  if (!vote) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  if (vote.electorate_mode === "per_member") member.decode(memberResult, vote);
  else {
    if (input.memberId != null)
      throw new AppError(422, "MEMBER_ID_NOT_ALLOWED", "Per-person votes do not accept a Member selection");
    person.decode(personResult);
  }
  assertVoteOpen(vote, now);
  if (vote.vote_type !== "election" && vote.question_form_id) {
    assertConsultationFormUsable(vote.form_status ? { status: vote.form_status } : null, vote.form_field_count);
  }
  validateBallotChoice(vote, input.choice, vote.standing_candidate === 1, vote.question_form_id !== null);
  if ((memberWrite.meta?.changes ?? 0) + (personWrite.meta?.changes ?? 0) !== 1) {
    if (vote.electorate_mode === "per_member")
      assertRecordedMemberBallotUnchanged(vote.recorded_at ?? "", input.replacesBallotCastAt ?? null);
    throw new AppError(409, "VOTE_CHANGED", "Voting eligibility or the voting window changed; reload and retry");
  }
}
