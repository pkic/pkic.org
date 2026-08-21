import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import { prepareConsentStatements, validateRequiredConsents } from "./consent";
import { getRequiredTerms } from "./events";
import { getSpeakerByManageToken } from "./proposals";
import { prepareUserProfileStatement, type UserProfilePatch } from "./users";
import type { DatabaseLike } from "../types";

export async function getProposalCoSpeakers(
  db: DatabaseLike,
  proposalId: string,
  excludeUserId: string,
): Promise<{ firstName: string | null; lastName: string | null; status: string }[]> {
  return all<{ first_name: string | null; last_name: string | null; status: string }>(
    db,
    `SELECT u.first_name, u.last_name, ps.status
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id != ?
     ORDER BY ps.created_at ASC`,
    [proposalId, excludeUserId],
  ).then((rows) => rows.map((r) => ({ firstName: r.first_name, lastName: r.last_name, status: r.status })));
}

export async function getPresentationUploader(
  db: DatabaseLike,
  proposalId: string,
): Promise<{ firstName: string | null; lastName: string | null; uploadedAt: string } | null> {
  const row = await first<{
    first_name: string | null;
    last_name: string | null;
    uploaded_at: string;
  }>(
    db,
    `SELECT u.first_name, u.last_name, pv.uploaded_at
     FROM presentation_versions pv
     LEFT JOIN users u ON u.id = pv.uploaded_by_user_id
     WHERE pv.proposal_id = ? AND pv.is_current = 1 AND pv.deleted_at IS NULL`,
    [proposalId],
  );
  if (!row) return null;
  return { firstName: row.first_name, lastName: row.last_name, uploadedAt: row.uploaded_at };
}

export async function confirmSpeakerParticipation(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
  payload: {
    consents: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken, signingSecret);

  if (speaker.status === "confirmed") {
    return;
  }
  if (speaker.status === "declined") {
    throw new AppError(
      409,
      "SPEAKER_ALREADY_DECLINED",
      "You have already declined participation. Please contact the organizer if you changed your mind.",
    );
  }
  const requiredTerms = await getRequiredTerms(db, proposal.event_id, "speaker");
  await validateRequiredConsents(requiredTerms, payload.consents);
  const now = nowIso();
  await db.batch([
    ...(await prepareConsentStatements(db, {
      proposalId: proposal.id,
      eventId: proposal.event_id,
      userId: speaker.user_id,
      audienceType: "speaker",
      accepted: payload.consents,
      ip: payload.ip,
      userAgent: payload.userAgent,
      secret: signingSecret,
    })),
    db
      .prepare(
        `UPDATE proposal_speakers
         SET status = 'confirmed', confirmed_at = ?, terms_accepted_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, speaker.id),
    prepareAuditLog(db, "user", speaker.user_id, "speaker_confirmed", "proposal_speaker", speaker.id, {
      proposalId: speaker.proposal_id,
    }),
  ]);
}

export async function declineSpeakerParticipation(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
  payload: { reason?: string | null },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken, signingSecret);

  if (speaker.status === "declined") {
    return;
  }

  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE proposal_speakers
         SET status = 'declined', declined_at = ?, decline_reason = ?
         WHERE id = ?`,
      )
      .bind(now, payload.reason ?? null, speaker.id),
    db
      .prepare(
        `UPDATE event_participants
         SET status = 'inactive', updated_at = ?
         WHERE event_id = ? AND user_id = ? AND source_type = 'proposal' AND source_ref = ?`,
      )
      .bind(now, proposal.event_id, speaker.user_id, proposal.id),
    prepareAuditLog(db, "user", speaker.user_id, "speaker_declined", "proposal_speaker", speaker.id, {
      proposalId: speaker.proposal_id,
      reason: payload.reason ?? null,
    }),
  ]);
}

export async function updateSpeakerProfile(db: DatabaseLike, userId: string, payload: UserProfilePatch): Promise<void> {
  await db.batch([prepareUserProfileStatement(db, userId, payload)]);
}

export const prepareSpeakerProfileStatement = prepareUserProfileStatement;
