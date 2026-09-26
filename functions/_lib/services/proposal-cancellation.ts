import { prepareQueueEmailStatementWhen } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { requireAdminDatabaseUserId } from "../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { buildEventEmailVariables } from "./events";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import { prepareCancelProposalEmails } from "./proposal-email-cancellation";
import { prepareProposalRoleCapacityForProposalStatus } from "./proposal-role-capacity";
import { isProposalSpeakerRosterConflict } from "./proposal-speaker-roster-revision";
import { listProposalSpeakersWithStatus, type ProposalSpeakerWithUser } from "./proposal-speakers";
import {
  proposalDecisionSnapshotPredicate,
  snapshotProposalDecisionSpeaker,
  type ProposalDecisionEventSnapshot,
} from "./proposal-decisions/snapshot";
import { isRegistrationTransitionConflict } from "./registrations/transition-guard";
import { withProposalWriteContextGuard, type ProposalWriteAuthorization } from "./proposal-write-authorization";

interface AcceptedProposal {
  id: string;
  event_id: string;
  title: string;
  status: string;
  updated_at: string;
}

interface CancellationEvent {
  name: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

export interface CanceledAcceptedProposal {
  proposalId: string;
  status: "canceled";
  canceledAt: string;
  notifiedSpeakerCount: number;
  outboxIds: string[];
}

function eventSnapshot(event: CancellationEvent): ProposalDecisionEventSnapshot {
  return {
    name: event.name,
    slug: event.slug,
    basePath: event.base_path,
    startsAt: event.starts_at,
    settingsJson: event.settings_json,
  };
}

function speakerName(speaker: ProposalSpeakerWithUser): string {
  return [speaker.first_name, speaker.last_name].filter(Boolean).join(" ").trim() || speaker.email;
}

function cancellationConflict(): AppError {
  return new AppError(
    409,
    "PROPOSAL_CANCELLATION_CONFLICT",
    "The proposal, speaker roster, or event changed while cancellation was being saved",
  );
}

/**
 * Cancels one accepted proposal without rewriting its accepted decision.
 * Status, reason, capacity, queued-mail cancellation, new speaker notices,
 * and audit evidence commit in one guarded D1 batch.
 */
export async function cancelAcceptedProposal(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  comment: string,
  appBaseUrl: string,
  authorization?: ProposalWriteAuthorization,
): Promise<CanceledAcceptedProposal> {
  const actorUserId = requireAdminDatabaseUserId(actor);
  const normalizedComment = comment.trim();
  if (!normalizedComment)
    throw new AppError(400, "CANCELLATION_COMMENT_REQUIRED", "A cancellation comment is required");

  const proposal = await first<AcceptedProposal>(
    db,
    `SELECT id, event_id, title, status, updated_at
       FROM session_proposals
      WHERE id = ? AND deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  if (proposal.status !== "accepted") {
    throw new AppError(409, "PROPOSAL_NOT_ACCEPTED", "Only an accepted proposal can be canceled");
  }
  const access = await getProposalAccessForEvent(db, proposal.event_id, actor);
  if (!access.canCancelAcceptedProposal) {
    throw new AppError(403, "FORBIDDEN", "Missing permission to cancel accepted proposals");
  }

  const event = await first<CancellationEvent>(
    db,
    `SELECT name, slug, base_path, starts_at, settings_json FROM events WHERE id = ?`,
    [proposal.event_id],
  );
  if (!event) throw new AppError(409, "PROPOSAL_EVENT_NOT_FOUND", "The proposal event no longer exists");
  const speakers = await listProposalSpeakersWithStatus(db, proposal.id);
  const snapshot = proposalDecisionSnapshotPredicate(
    eventSnapshot(event),
    speakers.map(snapshotProposalDecisionSpeaker),
  );
  const canceledAt = nowIso();
  const cancellationCondition = {
    sql: `SELECT 1 FROM session_proposals
           WHERE id = ? AND event_id = ? AND status = 'canceled'
             AND canceled_at = ? AND canceled_by_user_id = ? AND cancellation_comment = ?`,
    bindings: [proposal.id, proposal.event_id, canceledAt, actorUserId, normalizedComment],
  };
  const preparedEmails = speakers.map((speaker) => {
    const recipientCondition = {
      sql: `${cancellationCondition.sql}
              AND EXISTS (
                SELECT 1 FROM proposal_speakers ps
                JOIN users u ON u.id = ps.user_id
                WHERE ps.proposal_id = ? AND ps.id = ? AND ps.user_id = ? AND ps.status = ? AND u.email = ?
              )
              AND EXISTS (SELECT 1 FROM events WHERE id = ? AND name = ?)`,
      bindings: [
        ...cancellationCondition.bindings,
        proposal.id,
        speaker.speaker_id,
        speaker.user_id,
        speaker.status,
        speaker.email,
        proposal.event_id,
        event.name,
      ],
    };
    return prepareQueueEmailStatementWhen(
      db,
      {
        outboxId: uuid(),
        idempotencyKey: `proposal-canceled:${proposal.id}:${speaker.user_id}`,
        eventId: proposal.event_id,
        templateKey: "proposal_canceled",
        recipientEmail: speaker.email,
        recipientUserId: speaker.user_id,
        subject: `Session canceled: ${proposal.title}`,
        messageType: "transactional",
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          proposalId: proposal.id,
          speakerUserId: speaker.user_id,
          firstNameText: emailPlainText(speaker.first_name ?? speakerName(speaker)),
          proposalTitleText: emailPlainText(proposal.title),
          eventNameText: emailPlainText(event.name),
          cancellationCommentText: emailPlainText(normalizedComment),
        },
      },
      recipientCondition,
      canceledAt,
    );
  });

  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "proposals:cancel_accepted", context: { type: "event", id: proposal.event_id } },
    ]),
    db
      .prepare(
        `UPDATE session_proposals AS sp
            SET status = 'canceled', canceled_at = ?, canceled_by_user_id = ?,
                cancellation_comment = ?, updated_at = ?
          WHERE sp.id = ? AND sp.event_id = ? AND sp.status = 'accepted' AND sp.updated_at = ?
            AND sp.deleted_at IS NULL
            ${snapshot.sql}`,
      )
      .bind(
        canceledAt,
        actorUserId,
        normalizedComment,
        canceledAt,
        proposal.id,
        proposal.event_id,
        proposal.updated_at,
        ...snapshot.bindings,
      ),
    prepareAuditLogAfterOneChange(
      db,
      "admin",
      actor.id,
      "accepted_proposal_canceled",
      "proposal",
      proposal.id,
      {
        status: { from: "accepted", to: "canceled" },
        cancellationComment: { from: null, to: normalizedComment },
        notifiedSpeakerCount: { from: 0, to: speakers.length },
      },
      canceledAt,
      { type: "event", id: proposal.event_id },
    ),
    prepareCancelProposalEmails(
      db,
      {
        proposalId: proposal.id,
        eventId: proposal.event_id,
        reason: "Canceled because the accepted proposal was removed from the program",
        conditionSql: cancellationCondition.sql,
        conditionBindings: cancellationCondition.bindings,
      },
      canceledAt,
    ),
    ...(await prepareProposalRoleCapacityForProposalStatus(db, {
      eventId: proposal.event_id,
      sourceRef: proposal.id,
      nextStatus: "inactive",
    })),
  ];
  for (const [index, prepared] of preparedEmails.entries()) {
    const speaker = speakers[index];
    statements.push(
      prepared.statement,
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "proposal_cancellation_email_queued",
        "proposal",
        proposal.id,
        { recipientUserId: { from: null, to: speaker.user_id }, recipientEmail: { from: null, to: speaker.email } },
        canceledAt,
        { type: "event", id: proposal.event_id },
      ),
    );
  }

  try {
    await db.batch(withProposalWriteContextGuard(authorization, statements));
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_CANCELLATION_AUTHORIZATION_CHANGED",
        "Cancellation permission changed while the proposal was being canceled",
      );
    }
    if (
      isAuditChangeGuardFailure(error) ||
      isRegistrationTransitionConflict(error) ||
      isEventParticipantSourceConflict(error) ||
      isProposalSpeakerRosterConflict(error)
    ) {
      throw cancellationConflict();
    }
    throw error;
  }

  return {
    proposalId: proposal.id,
    status: "canceled",
    canceledAt,
    notifiedSpeakerCount: speakers.length,
    outboxIds: preparedEmails.map((prepared) => prepared.id),
  };
}
