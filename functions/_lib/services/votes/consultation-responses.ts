import { AppError } from "../../errors";
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { getActiveFormById } from "../forms/read";
import { prepareCreateFormSubmission, prepareFormAnswerMutations } from "../forms/submission-command";
import { validateCustomAnswersAgainstForm, type CustomAnswerValue } from "../forms/validation";
import type { DatabaseLike } from "../../types";
import { assertVoteOpen, resolvePerMemberCapacity, resolvePerPersonCapacity, type BallotActor } from "./ballots";
import { loadConsultationForm } from "./question";
import { getVoteRowOrThrow } from "./shared";

/**
 * Records one consultation response.
 *
 * Eligibility, the window, and one-response-per-Member are resolved through
 * exactly the same helpers a ballot uses, because they are the same rules —
 * only the thing being recorded differs. The answers themselves go through the
 * ordinary form submission command, so nothing here invents a second way to
 * store a form response.
 */
export async function submitConsultationResponse(
  db: DatabaseLike,
  member: BallotActor,
  voteIdOrSlug: string,
  requestedMemberId: string | null | undefined,
  answers: Record<string, CustomAnswerValue>,
  throughGroupId?: string,
): Promise<void> {
  const vote = await getVoteRowOrThrow(db, voteIdOrSlug);
  const consultation = await loadConsultationForm(db, vote);
  if (!consultation) {
    throw new AppError(422, "VOTE_TAKES_A_BALLOT", "This vote is answered by casting a ballot, not by a form response");
  }

  let memberId: string | null = null;
  if (vote.electorate_mode === "per_member") {
    const capacity = await resolvePerMemberCapacity(db, vote, member, requestedMemberId, throughGroupId);
    memberId = capacity.memberId;
  } else {
    if (requestedMemberId != null) {
      throw new AppError(422, "MEMBER_ID_NOT_ALLOWED", "Per-person votes do not accept a Member selection");
    }
    await resolvePerPersonCapacity(db, vote, member, throughGroupId);
  }

  const now = nowIso();
  assertVoteOpen(vote, now);

  const form = await getActiveFormById(db, consultation.id);
  if (!form) throw new AppError(409, "VOTE_FORM_MISSING", "This consultation's form is no longer active");
  const validated = validateCustomAnswersAgainstForm(form, { customAnswers: answers });

  // Replacing a response supersedes the previous one outright rather than
  // editing it, so a changed mind leaves one answer set and the superseded
  // submission stays readable as history.
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM vote_consultation_responses
      WHERE vote_id = ? AND round = ? AND ${memberId === null ? "member_id IS NULL AND user_id = ?" : "member_id = ?"}`,
    [vote.id, vote.current_round, memberId === null ? member.userId : memberId],
  );

  const submission = prepareCreateFormSubmission(
    db,
    form,
    { submittedByUserId: member.userId, contextType: "survey", contextRef: vote.id },
    validated,
    now,
  );

  const linkId = uuid();
  await db.batch([
    ...submission.statements,
    ...prepareFormAnswerMutations(db, form, submission.id, validated, now),
    existing
      ? db
          .prepare(
            `UPDATE vote_consultation_responses
                SET submission_id = ?, user_id = ?, updated_at = ?
              WHERE id = ?`,
          )
          .bind(submission.id, member.userId, now, existing.id)
      : db
          .prepare(
            `INSERT INTO vote_consultation_responses
               (id, vote_id, user_id, member_id, submission_id, round, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(linkId, vote.id, member.userId, memberId, submission.id, vote.current_round, now, now),
  ]);
}

/** Whether this caller has already responded, for the read model. */
export async function hasRespondedToConsultation(
  db: DatabaseLike,
  voteId: string,
  round: number,
  userId: string,
  memberId: string | null,
): Promise<boolean> {
  const row = await first<{ id: string }>(
    db,
    `SELECT id FROM vote_consultation_responses
      WHERE vote_id = ? AND round = ? AND ${memberId === null ? "member_id IS NULL AND user_id = ?" : "member_id = ?"}`,
    [voteId, round, memberId === null ? userId : memberId],
  );
  return row !== null && row !== undefined;
}
