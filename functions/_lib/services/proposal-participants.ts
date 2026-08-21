import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import type { DatabaseLike, StatementLike } from "../types";

function participantRoleForProposalRole(role: string): { role: string; subrole: string | null } {
  if (role === "moderator") return { role: "moderator", subrole: null };
  if (role === "panelist") return { role: "panelist", subrole: null };
  return { role: "speaker", subrole: role };
}

export function prepareUpsertProposalParticipant(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    proposalRole: string;
    sourceRef: string;
    status?: "active" | "inactive";
  },
): StatementLike {
  const participant = participantRoleForProposalRole(payload.proposalRole);
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO event_participants (
        id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'proposal', ?, ?, ?)
      ON CONFLICT(event_id, user_id, role, subrole)
      DO UPDATE SET status = excluded.status, source_ref = excluded.source_ref, updated_at = excluded.updated_at`,
    )
    .bind(
      uuid(),
      payload.eventId,
      payload.userId,
      participant.role,
      participant.subrole,
      payload.status ?? "active",
      payload.sourceRef,
      now,
      now,
    );
}

export function prepareDeactivateProposalParticipantRoles(
  db: DatabaseLike,
  payload: { eventId: string; userId: string; sourceRef: string },
): StatementLike {
  return db
    .prepare(
      `UPDATE event_participants
       SET status = 'inactive', updated_at = ?
       WHERE event_id = ? AND user_id = ? AND source_type = 'proposal' AND source_ref = ?`,
    )
    .bind(nowIso(), payload.eventId, payload.userId, payload.sourceRef);
}

export function prepareSyncProposalParticipantRole(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    proposalRole: string;
    sourceRef: string;
    status: "active" | "inactive";
  },
): StatementLike[] {
  return [prepareDeactivateProposalParticipantRoles(db, payload), prepareUpsertProposalParticipant(db, payload)];
}
