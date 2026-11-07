import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { isLateSpeakerResponseAwaitingReview } from "../../../assets/shared/proposal-speaker-acceptance";
import { requireUserBackedAuthAdmin } from "../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { getSpeakerByProposalUser } from "./proposals-speaker-capability";
import { requireProposalSpeakerPermission } from "./proposal-speaker-access";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { prepareSpeakerResponseNotices } from "./proposal-speaker-response-notice";

/** Refuses a pending late response; it never changes proposal acceptance or a program placement. */
export async function rejectLateSpeakerParticipation(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  userId: string,
  appBaseUrl: string,
): Promise<string | null> {
  requireUserBackedAuthAdmin(actor);
  const context = await getSpeakerByProposalUser(db, proposalId, userId);
  await requireProposalSpeakerPermission(db, actor, context.proposal.event_id, "manage");
  const { speaker, proposal } = context;
  if (speaker.status === "declined") return null;
  if (
    !isLateSpeakerResponseAwaitingReview(
      speaker.status,
      speaker.response_invite_generation,
      speaker.invite_generation,
    ) ||
    !isProposalSpeakerRosterEditableStatus(proposal.status)
  )
    throw new AppError(409, "SPEAKER_REVIEW_NOT_PENDING", "This speaker has no late response awaiting review.");
  const at = nowIso();
  const notices = await prepareSpeakerResponseNotices(db, context, { late: true, rejected: true, appBaseUrl, at });
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "proposals:manage", context: { type: "event", id: proposal.event_id } },
      ]),
      db
        .prepare(`UPDATE proposal_speakers SET status='declined',declined_at=?,decline_reason='Late participation was not approved'
        WHERE id=? AND status='pending' AND invite_generation=? AND response_invite_generation=invite_generation AND terms_accepted_at IS ?
          AND EXISTS(SELECT 1 FROM session_proposals WHERE id=? AND status=? AND updated_at=? AND deleted_at IS NULL)`)
        .bind(
          at,
          speaker.id,
          speaker.invite_generation,
          speaker.terms_accepted_at,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: proposal.id },
        "admin",
        actor.id,
        "speaker_late_response_rejected",
        "proposal_speaker",
        speaker.id,
        { proposalId },
        at,
      ),
      ...notices.map((notice) => notice.statement),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "The speaker response changed. Refresh before reviewing it.",
      );
    throw error;
  }
  return null;
}
