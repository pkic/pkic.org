import { run } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { writeAuditLog } from "./audit";
import { getSpeakerByManageToken } from "./proposals";
import type { DatabaseLike } from "../types";

export async function confirmSpeakerParticipation(
  db: DatabaseLike,
  manageToken: string,
  payload: { termsAccepted: boolean },
): Promise<void> {
  const { speaker } = await getSpeakerByManageToken(db, manageToken);

  if (speaker.status === "confirmed") {
    return;
  }
  if (speaker.status === "declined") {
    throw new AppError(
      409,
      "SPEAKER_ALREADY_DECLINED",
      "You have already declined participation. Please contact the organiser if you changed your mind.",
    );
  }
  if (!payload.termsAccepted) {
    throw new AppError(400, "TERMS_NOT_ACCEPTED", "You must accept the participation terms to confirm.");
  }

  const now = nowIso();
  await run(
    db,
    `UPDATE proposal_speakers
     SET status = 'confirmed', confirmed_at = ?, terms_accepted_at = ?
     WHERE id = ?`,
    [now, now, speaker.id],
  );
  await writeAuditLog(db, "user", speaker.user_id, "speaker_confirmed", "proposal_speaker", speaker.id, {
    proposalId: speaker.proposal_id,
  });
}

export async function declineSpeakerParticipation(
  db: DatabaseLike,
  manageToken: string,
  payload: { reason?: string | null },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken);

  if (speaker.status === "declined") {
    return;
  }

  const now = nowIso();
  await run(
    db,
    `UPDATE proposal_speakers
     SET status = 'declined', declined_at = ?, decline_reason = ?
     WHERE id = ?`,
    [now, payload.reason ?? null, speaker.id],
  );

  await run(
    db,
    `UPDATE event_participants
     SET status = 'inactive', updated_at = ?
     WHERE event_id = ? AND user_id = ? AND source_type = 'proposal' AND source_ref = ?`,
    [now, proposal.event_id, speaker.user_id, proposal.id],
  );
  await writeAuditLog(db, "user", speaker.user_id, "speaker_declined", "proposal_speaker", speaker.id, {
    proposalId: speaker.proposal_id,
    reason: payload.reason ?? null,
  });
}

export async function updateSpeakerProfile(
  db: DatabaseLike,
  userId: string,
  payload: {
    firstName?: string | null;
    lastName?: string | null;
    organizationName?: string | null;
    jobTitle?: string | null;
    biography?: string | null;
    linksJson?: string | null;
    headshotR2Key?: string | null;
  },
): Promise<void> {
  const now = nowIso();
  const assignments: string[] = [];
  const values: Array<string | null> = [];

  if (Object.prototype.hasOwnProperty.call(payload, "firstName")) {
    assignments.push("first_name = ?");
    values.push(payload.firstName ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "lastName")) {
    assignments.push("last_name = ?");
    values.push(payload.lastName ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "organizationName")) {
    assignments.push("organization_name = ?");
    values.push(payload.organizationName ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "jobTitle")) {
    assignments.push("job_title = ?");
    values.push(payload.jobTitle ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "biography")) {
    assignments.push("biography = ?");
    values.push(payload.biography ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "linksJson")) {
    assignments.push("links_json = ?");
    values.push(payload.linksJson ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "headshotR2Key")) {
    assignments.push("headshot_r2_key = ?");
    values.push(payload.headshotR2Key ?? null);
    assignments.push("headshot_updated_at = ?");
    values.push(payload.headshotR2Key ? now : null);
  }

  assignments.push("updated_at = ?");
  values.push(now);

  await run(db, `UPDATE users SET ${assignments.join(", ")} WHERE id = ?`, [...values, userId]);
}

export async function recordPresentationUpload(db: DatabaseLike, proposalId: string, r2Key: string): Promise<void> {
  const now = nowIso();
  await run(
    db,
    `UPDATE session_proposals
     SET presentation_r2_key = ?, presentation_uploaded_at = ?, updated_at = ?
     WHERE id = ?`,
    [r2Key, now, now, proposalId],
  );
}
