import type { DatabaseLike } from "../types";
import { addHours, nowIso } from "../utils/time";
import { prepareAuditLogAfterOneChange } from "./audit";
import { getSpeakerByManageToken } from "./proposals";

export type SpeakerPresentationReminderAction = "postpone_7d" | "pause_30d" | "resume";

export async function setSpeakerPresentationReminderPreference(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
  action: SpeakerPresentationReminderAction,
): Promise<{ state: "active" | "postponed" | "paused"; pausedUntil: string | null }> {
  const { speaker } = await getSpeakerByManageToken(db, manageToken, signingSecret);
  const now = nowIso();
  const pausedUntil = action === "resume" ? null : addHours(now, action === "postpone_7d" ? 24 * 7 : 24 * 30);
  const state = action === "resume" ? "active" : action === "postpone_7d" ? "postponed" : "paused";

  await db.batch([
    db
      .prepare("UPDATE proposal_speakers SET presentation_reminders_paused_until = ? WHERE id = ?")
      .bind(pausedUntil, speaker.id),
    prepareAuditLogAfterOneChange(
      db,
      "user",
      speaker.user_id,
      "presentation_reminder_preference_updated",
      "proposal_speaker",
      speaker.id,
      { action, pausedUntil },
      now,
    ),
  ]);
  return { state, pausedUntil };
}
