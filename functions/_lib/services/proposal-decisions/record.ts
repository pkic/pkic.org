import { prepareQueueEmailStatementWhen } from "../../email/outbox";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange, prepareAuditLogWhen } from "../audit";
import { prepareCancelProposalEmails } from "../proposal-email-cancellation";
import {
  assertProposalDecisionAllowed,
  assertProposalFinalizeAccess,
  getProposalDecisionContext,
  isCurrentProposalDecisionConflict,
  isProposalDecisionHistoryConflict,
  throwProposalDecisionConflict,
} from "./context";
import type { RecordProposalDecisionInput, RecordedProposalDecision } from "./types";
import { proposalDecisionSnapshotPredicate } from "./snapshot";
import { prepareProposalRoleCapacityForProposalStatus } from "../proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "../registrations/transition-guard";
import { isEventParticipantSourceConflict } from "../event-participant-source-revision";
import { isProposalSpeakerRosterConflict } from "../proposal-speaker-roster-revision";

interface RecordedDecisionSnapshot {
  review_round: number;
  review_count: number;
}

export async function recordProposalDecision(
  db: DatabaseLike,
  input: RecordProposalDecisionInput,
): Promise<RecordedProposalDecision> {
  if (input.finalStatus === "needs-work" && !input.decisionNote?.trim()) {
    throw new AppError(
      400,
      "DECISION_NOTE_REQUIRED",
      "A proposal decision requesting changes requires a decision note",
    );
  }
  if (input.finalStatus !== "accepted" && input.presentationDeadline) {
    throw new AppError(
      400,
      "PRESENTATION_DEADLINE_NOT_ALLOWED",
      "A presentation deadline is only valid for accepted proposals",
    );
  }
  const context = await getProposalDecisionContext(db, input.proposalId);
  assertProposalDecisionAllowed(context, input.finalStatus, input.minReviewsRequired, input.expectedProposalUpdatedAt);
  await assertProposalFinalizeAccess(db, context.event_id, input.actor);
  const decisionId = uuid();
  const decisionSequence = Number(context.current_decision_sequence ?? 0) + 1;
  const supersedesDecisionId = context.current_decision_id;
  const now = nowIso();
  const hasEventSnapshot = input.expectedEventSnapshot !== undefined;
  const hasSpeakerSnapshot = input.expectedSpeakerSnapshot !== undefined;
  if ((input.notifications?.length ?? 0) > 0 && (!hasEventSnapshot || !hasSpeakerSnapshot)) {
    throw new Error("Proposal decision notifications require matching event and speaker snapshots");
  }
  if (hasEventSnapshot !== hasSpeakerSnapshot) {
    throw new Error("Proposal decision event and speaker snapshots must be supplied together");
  }
  const snapshotPredicate =
    input.expectedEventSnapshot && input.expectedSpeakerSnapshot
      ? proposalDecisionSnapshotPredicate(input.expectedEventSnapshot, input.expectedSpeakerSnapshot)
      : { sql: "", bindings: [] };
  const condition = {
    sql: `SELECT 1 FROM proposal_decisions
          WHERE id = ? AND proposal_id = ? AND review_round = ? AND decision_sequence = ?`,
    bindings: [decisionId, input.proposalId, context.review_round, decisionSequence],
  };
  const preparedEmails = (input.notifications ?? []).map((notification) =>
    prepareQueueEmailStatementWhen(
      db,
      {
        outboxId: uuid(),
        idempotencyKey: `proposal-decision:${decisionId}:${notification.id}`,
        eventId: context.event_id,
        templateKey: notification.templateKey,
        recipientEmail: notification.recipientEmail,
        recipientUserId: notification.recipientUserId,
        subject: notification.fallbackSubject,
        messageType: "transactional",
        capabilityLinkValues: [notification.data.manageUrl, notification.data.profileUrl, notification.data.uploadUrl],
        data: notification.data,
      },
      condition,
      now,
    ),
  );

  const recordCurrentDecision = supersedesDecisionId
    ? db
        .prepare(
          `UPDATE proposal_decisions
           SET id = ?, decided_by_user_id = ?, final_status = ?, decision_note = ?,
               min_reviews_required = ?,
               review_count = (
                 SELECT COUNT(*) FROM proposal_reviews pr
                 WHERE pr.proposal_id = proposal_decisions.proposal_id
                   AND pr.review_round = proposal_decisions.review_round
               ),
               decided_at = ?, decision_sequence = ?
           WHERE id = ? AND proposal_id = ? AND review_round = ?
             AND final_status = 'needs-work' AND decision_sequence = ?
             AND EXISTS (
               SELECT 1 FROM session_proposals sp
               WHERE sp.id = proposal_decisions.proposal_id AND sp.deleted_at IS NULL
                 AND sp.status = ? AND sp.review_round = ? AND sp.updated_at = ?
                 ${snapshotPredicate.sql}
                 AND (SELECT COUNT(*) FROM proposal_reviews pr
                      WHERE pr.proposal_id = sp.id AND pr.review_round = sp.review_round) >= ?
             )`,
        )
        .bind(
          decisionId,
          input.actor.id,
          input.finalStatus,
          input.decisionNote ?? null,
          input.minReviewsRequired,
          now,
          decisionSequence,
          supersedesDecisionId,
          input.proposalId,
          context.review_round,
          context.current_decision_sequence,
          context.status,
          context.review_round,
          context.updated_at,
          ...snapshotPredicate.bindings,
          input.minReviewsRequired,
        )
    : db
        .prepare(
          `INSERT INTO proposal_decisions (
             id, proposal_id, review_round, decided_by_user_id, final_status,
             decision_note, min_reviews_required, review_count, decided_at, decision_sequence
           )
           SELECT ?, sp.id, sp.review_round, ?, ?, ?, ?,
                  (SELECT COUNT(*) FROM proposal_reviews pr
                   WHERE pr.proposal_id = sp.id AND pr.review_round = sp.review_round), ?, ?
           FROM session_proposals sp
           WHERE sp.id = ? AND sp.deleted_at IS NULL AND sp.status = ? AND sp.review_round = ? AND sp.updated_at = ?
             ${snapshotPredicate.sql}
             AND NOT EXISTS (SELECT 1 FROM proposal_decisions pd WHERE pd.proposal_id = sp.id)
             AND (SELECT COUNT(*) FROM proposal_reviews pr
                  WHERE pr.proposal_id = sp.id AND pr.review_round = sp.review_round) >= ?`,
        )
        .bind(
          decisionId,
          input.actor.id,
          input.finalStatus,
          input.decisionNote ?? null,
          input.minReviewsRequired,
          now,
          decisionSequence,
          input.proposalId,
          context.status,
          context.review_round,
          context.updated_at,
          ...snapshotPredicate.bindings,
          input.minReviewsRequired,
        );

  const statements: StatementLike[] = [
    recordCurrentDecision,
    prepareAuditLogAfterOneChange(
      db,
      "admin",
      input.actor.id,
      "proposal_decision_recorded",
      "proposal",
      input.proposalId,
      {
        adminEmail: { from: null, to: input.actor.email },
        finalStatus: { from: context.previous_status, to: input.finalStatus },
        decisionNote: { from: context.previous_note, to: input.decisionNote ?? null },
        reviewRound: { from: context.previous_review_round, to: context.review_round },
        decisionSequence: { from: context.current_decision_sequence, to: decisionSequence },
        supersedesDecisionId: { from: supersedesDecisionId, to: decisionId },
        queuedEmailCount: { from: 0, to: preparedEmails.length },
        manageLinkPolicy: { from: null, to: "expiring_capability" },
      },
      now,
    ),
    db
      .prepare(
        `INSERT INTO proposal_decision_history (
           id, proposal_id, review_round, decided_by_user_id, final_status,
           decision_note, min_reviews_required, review_count, decided_at, decision_sequence
         )
         SELECT id, proposal_id, review_round, decided_by_user_id, final_status,
                decision_note, min_reviews_required, review_count, decided_at, decision_sequence
         FROM proposal_decisions
         WHERE id = ? AND proposal_id = ? AND review_round = ? AND decision_sequence = ?`,
      )
      .bind(decisionId, input.proposalId, context.review_round, decisionSequence),
    db
      .prepare(
        `INSERT INTO proposal_review_history (
           decision_id, proposal_id, review_round, review_id, reviewer_user_id,
           recommendation, score, reviewer_comment, applicant_note, reviewed_at, captured_at
         )
         SELECT ?, pr.proposal_id, pr.review_round, pr.id, pr.reviewer_user_id,
                pr.recommendation, pr.score, pr.reviewer_comment, pr.applicant_note,
                pr.updated_at, ?
         FROM proposal_reviews pr
         WHERE pr.proposal_id = ? AND pr.review_round = ?
           AND EXISTS (${condition.sql})`,
      )
      .bind(decisionId, now, input.proposalId, context.review_round, ...condition.bindings),
    db
      .prepare(
        `UPDATE session_proposals
         SET status = ?, presentation_deadline = CASE WHEN ? = 'accepted' AND ? IS NOT NULL THEN ? ELSE presentation_deadline END,
             updated_at = ?
         WHERE id = ? AND status = ? AND review_round = ? AND updated_at = ?
           AND EXISTS (${condition.sql})`,
      )
      .bind(
        input.finalStatus,
        input.finalStatus,
        input.presentationDeadline ?? null,
        input.presentationDeadline ?? null,
        now,
        input.proposalId,
        context.status,
        context.review_round,
        context.updated_at,
        ...condition.bindings,
      ),
    ...(await prepareProposalRoleCapacityForProposalStatus(db, {
      eventId: context.event_id,
      sourceRef: input.proposalId,
      nextStatus: input.finalStatus === "accepted" ? "active" : "inactive",
    })),
  ];

  if (input.finalStatus === "rejected") {
    statements.push(
      prepareCancelProposalEmails(
        db,
        {
          proposalId: input.proposalId,
          eventId: context.event_id,
          reason: "Cancelled because the proposal was rejected",
          conditionSql: condition.sql,
          conditionBindings: condition.bindings,
        },
        now,
      ),
    );
  }

  for (const userId of input.presentationReminderUserIds ?? []) {
    statements.push(
      db
        .prepare(
          `UPDATE proposal_speakers
           SET presentation_last_communication_at = ?, presentation_reminders_paused_until = NULL
           WHERE proposal_id = ? AND user_id = ? AND EXISTS (${condition.sql})`,
        )
        .bind(now, input.proposalId, userId, ...condition.bindings),
    );
  }
  for (const [index, prepared] of preparedEmails.entries()) {
    const notification = (input.notifications ?? [])[index];
    statements.push(
      prepared.statement,
      prepareAuditLogWhen(db, {
        actorType: "admin",
        actorId: input.actor.id,
        action: "proposal_decision_email_queued",
        entityType: "proposal",
        entityId: input.proposalId,
        details: {
          templateKey: { from: null, to: notification.templateKey },
          recipientEmail: { from: null, to: notification.recipientEmail },
          recipientUserId: { from: null, to: notification.recipientUserId },
        },
        createdAt: now,
        conditionSql: condition.sql,
        conditionBindings: condition.bindings,
      }),
    );
  }
  statements.push(
    db
      .prepare("SELECT review_round, review_count FROM proposal_decisions WHERE id = ? AND proposal_id = ?")
      .bind(decisionId, input.proposalId),
  );

  try {
    const results = await db.batch(statements);
    if ((results[0].meta?.changes ?? 0) !== 1) {
      return throwProposalDecisionConflict(
        db,
        input.proposalId,
        input.finalStatus,
        input.minReviewsRequired,
        input.expectedProposalUpdatedAt,
      );
    }
    const selected = results.at(-1);
    if (!selected) throw new Error("Recorded proposal decision result is missing");
    const snapshot = batchFirst<RecordedDecisionSnapshot>(selected);
    if (!snapshot) throw new Error("Recorded proposal decision could not be reloaded");
    return {
      decisionId,
      reviewRound: Number(snapshot.review_round),
      reviewCount: Number(snapshot.review_count),
      outboxIds: preparedEmails.map(({ id }) => id),
    };
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (isProposalDecisionHistoryConflict(error)) {
      throw new Error("Proposal decision history already contains the current review round", { cause: error });
    }
    if (
      !isCurrentProposalDecisionConflict(error) &&
      !isAuditOneChangeGuardFailure(error) &&
      !isEventParticipantSourceConflict(error) &&
      !isProposalSpeakerRosterConflict(error)
    ) {
      throw error;
    }
    return throwProposalDecisionConflict(
      db,
      input.proposalId,
      input.finalStatus,
      input.minReviewsRequired,
      input.expectedProposalUpdatedAt,
    );
  }
}
