import type { DatabaseLike } from "../types";
import { addHours, nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { AppError } from "../errors";
import { getSpeakerByManageToken } from "./proposals";

export type SpeakerPresentationReminderState = "active" | "postponed" | "paused";

export async function setSpeakerPresentationReminderPreference(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
  state: SpeakerPresentationReminderState,
): Promise<{ state: "active" | "postponed" | "paused"; pausedUntil: string | null }> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken, signingSecret);
  const now = nowIso();
  const pausedUntil = state === "active" ? null : addHours(now, state === "postponed" ? 24 * 7 : 24 * 30);

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE proposal_speakers
              SET presentation_reminders_paused_until = ?
            WHERE id = ? AND proposal_id = ? AND user_id = ? AND status = ? AND invite_generation = ?
              AND EXISTS (
                SELECT 1 FROM session_proposals
                 WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
              )`,
        )
        .bind(
          pausedUntil,
          speaker.id,
          proposal.id,
          speaker.user_id,
          speaker.status,
          speaker.invite_generation,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: speaker.proposal_id },
        "user",
        speaker.user_id,
        "presentation_reminder_preference_updated",
        "proposal_speaker",
        speaker.id,
        { state, pausedUntil },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "Speaker access changed while the reminder preference was being updated",
      );
    }
    throw error;
  }
  return { state, pausedUntil };
}
