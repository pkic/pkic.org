import { isLateSpeakerResponseAwaitingReview } from "../../../assets/shared/proposal-speaker-acceptance";
import { prepareSpeakerResponseNotices } from "./proposal-speaker-response-notice";
import { personDisplayName } from "../../../assets/shared/person-display";
import { anotherProposalSpeakerRemainsSql, requireAnotherProposalSpeaker } from "./proposal-speaker-retention";
import { prepareSpeakerSelfAuthorityGuard } from "./proposals-speaker-profile";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { speakerInvitedAddressOwnedSql } from "./proposal-speaker-invited-address";
import type { ParticipantAuthority } from "./participant-authority";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import type { DatabaseLike, StatementLike } from "../types";
import { prepareQueueEmailStatement } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { sha256Hex } from "../utils/crypto";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { buildEventEmailVariables, getEventById, type EventRecord } from "./events";
import { queuedCapabilityToken } from "./capability-links";
import { proposalManagePageUrl } from "./frontend-links";
import { getSpeakerByManageToken } from "./proposals";
import { prepareProposalRoleCapacityForSpeakerRemoval } from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { prepareDeclinedSpeakerAgendaRemoval } from "./event-agenda/declined-speaker-removal";

/**
 * Tells the proposer, through the outbox and in the decline's own batch, that a speaker declined and why.
 * A speaker who never accepted is named by the address the proposer invited, not by their account's profile.
 */
async function prepareProposerDeclineNotice(
  db: DatabaseLike,
  input: {
    event: EventRecord;
    proposal: { id: string; title: string; proposer_user_id: string };
    speaker: { id: string; user_id: string; status: string; invite_generation: number };
    speakerName: string;
    speakerEmail: string;
    reason: string | null;
    appBaseUrl: string;
  },
): Promise<{ statements: StatementLike[]; outboxId: string | null }> {
  const none = { statements: [], outboxId: null };
  if (input.speaker.user_id === input.proposal.proposer_user_id) return none;
  const proposer = await first<{ email: string; first_name: string | null }>(
    db,
    "SELECT email, first_name FROM users WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL",
    [input.proposal.proposer_user_id],
  );
  if (!proposer) return none;
  const manageUrl = proposalManagePageUrl(
    input.appBaseUrl,
    input.event,
    queuedCapabilityToken("proposal_manage", input.proposal.id),
  );
  const key = `proposal_speaker_declined:${input.speaker.id}:${input.speaker.invite_generation}`;
  const speakerName = (input.speaker.status === "confirmed" && input.speakerName) || input.speakerEmail;
  const outboxId = (await sha256Hex(key)).slice(0, 32);
  const queued = [
    prepareQueueEmailStatement(db, {
      outboxId,
      idempotencyKey: key,
      eventId: input.event.id,
      baseUrl: input.appBaseUrl,
      templateKey: "proposal_speaker_declined",
      recipientEmail: proposer.email,
      recipientUserId: input.proposal.proposer_user_id,
      messageType: "transactional",
      subject: `A speaker declined your proposal — ${input.event.name}`,
      capabilityLinkValues: [manageUrl],
      data: {
        ...buildEventEmailVariables(input.event, input.appBaseUrl),
        proposalId: input.proposal.id,
        firstName: emailPlainText(proposer.first_name ?? ""),
        speakerName: emailPlainText(speakerName),
        proposalTitle: emailPlainText(input.proposal.title),
        declineReason: emailPlainText(input.reason ?? ""),
        manageUrl,
      },
    }).statement,
  ];
  return { statements: queued, outboxId };
}

/**
 * A speaker declines their own participation. The decline, the roster's
 * capacity, and their removal from every session the proposal was placed in
 * commit together; the agenda's organizers are told through the outbox. The
 * outbox ids of the proposer's notice are returned so the route sends it now.
 */
export async function declineSpeakerParticipation(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  signingSecret: string,
  payload: { reason?: string | null; appBaseUrl: string },
): Promise<{ outboxIds: string[] }> {
  const context = await getSpeakerByManageToken(db, manageToken, signingSecret, {
    allowLateResponseWithdrawal: true,
  });
  const { speaker, proposal, user } = context;

  if (speaker.status === "declined") {
    return { outboxIds: [] };
  }
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker participation cannot be changed on a closed proposal");
  }

  await requireAnotherProposalSpeaker(db, proposal.id);

  const now = nowIso();
  const event = await getEventById(db, proposal.event_id);
  // A speaker who declines leaves every session their proposal was placed in, in this same batch.
  const agendaRemoval = await prepareDeclinedSpeakerAgendaRemoval(db, {
    event,
    proposal,
    speaker: {
      userId: speaker.user_id,
      name: personDisplayName({ firstName: user.first_name, lastName: user.last_name }, "A speaker"),
    },
    appBaseUrl: payload.appBaseUrl,
    at: now,
  });
  const proposerNotice = await prepareProposerDeclineNotice(db, {
    event,
    proposal,
    speaker,
    speakerName: personDisplayName({ firstName: user.first_name, lastName: user.last_name }, "A speaker"),
    speakerEmail: speaker.invited_email ?? user.email,
    reason: payload.reason ?? null,
    appBaseUrl: payload.appBaseUrl,
  });
  const withdrawalNotices = isLateSpeakerResponseAwaitingReview(
    speaker.status,
    speaker.response_invite_generation,
    speaker.invite_generation,
  )
    ? await prepareSpeakerResponseNotices(db, context, {
        outcome: "withdrawn",
        appBaseUrl: payload.appBaseUrl,
        at: now,
        event,
      })
    : [];
  try {
    await db.batch([
      prepareSpeakerSelfAuthorityGuard(db, manageToken, {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        userId: speaker.user_id,
        inviteGeneration: speaker.invite_generation,
        expectedManageLinkSecret: speaker.manage_link_secret,
        allowLateResponseWithdrawal: true,
      }),
      db
        .prepare(
          `UPDATE proposal_speakers
           SET status = 'declined', declined_at = ?, decline_reason = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ? AND invite_generation = ?
             AND ${typeof manageToken === "string" ? "1" : speakerInvitedAddressOwnedSql("proposal_speakers")}
             AND ${anotherProposalSpeakerRemainsSql}
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          now,
          payload.reason ?? null,
          speaker.id,
          proposal.id,
          speaker.user_id,
          speaker.role,
          speaker.status,
          speaker.invite_generation,
          proposal.id,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: speaker.proposal_id },
        "user",
        speaker.user_id,
        "speaker_declined",
        "proposal_speaker",
        speaker.id,
        { proposalId: speaker.proposal_id, reason: payload.reason ?? null },
        now,
      ),
      ...(await prepareProposalRoleCapacityForSpeakerRemoval(db, {
        eventId: proposal.event_id,
        userId: speaker.user_id,
        sourceRef: proposal.id,
      })),
      ...agendaRemoval,
      ...proposerNotice.statements,
      ...withdrawalNotices.map((notice) => notice.statement),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        403,
        "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED",
        "Speaker authority changed. Sign in again or request a new link.",
      );
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (error instanceof Error && error.message.includes("AGENDA_REVISION_CHANGED"))
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "The agenda changed while the decline was processed. Try again.",
      );
    if (!isAuditChangeGuardFailure(error) && !isEventParticipantSourceConflict(error)) throw error;

    await requireAnotherProposalSpeaker(db, proposal.id);
    throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the decline was processed");
  }
  return {
    outboxIds: [
      ...(proposerNotice.outboxId ? [proposerNotice.outboxId] : []),
      ...withdrawalNotices.flatMap((notice) => notice.ids),
    ],
  };
}
