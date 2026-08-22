import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import type { DatabaseLike, StatementLike } from "../types";
import { all } from "../db/queries";
import { prepareRoleCapacityReconciliationStatements } from "./registrations/role-capacity-reconciliation";
import type { EventParticipantRole, ProposalSpeakerRole } from "../../../assets/shared/schemas/participant-roles";
import {
  getEventParticipantSourceRevision,
  prepareEventParticipantSourceRevisionGuard,
} from "./event-participant-source-revision";
import {
  getProposalSpeakerRosterRevision,
  prepareProposalSpeakerRosterRevisionGuard,
} from "./proposal-speaker-roster-revision";

export interface ProposalParticipantMapping {
  role: EventParticipantRole;
  subrole: string | null;
}

export interface ProposalParticipantProjection extends ProposalParticipantMapping {
  sourceRef: string;
  proposalRole: ProposalSpeakerRole;
  status: "active" | "inactive";
}

export function participantRoleForProposalRole(role: ProposalSpeakerRole): ProposalParticipantMapping {
  if (role === "moderator") return { role: "moderator", subrole: null };
  if (role === "panelist") return { role: "panelist", subrole: null };
  return { role: "speaker", subrole: role };
}

export function proposalParticipantStatus(proposalStatus: string, speakerStatus: string): "active" | "inactive" {
  return proposalStatus === "accepted" && speakerStatus !== "declined" ? "active" : "inactive";
}

export function prepareUpsertProposalParticipant(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    proposalRole: ProposalSpeakerRole;
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
      DO UPDATE SET status = excluded.status, source_ref = excluded.source_ref, updated_at = excluded.updated_at
      WHERE event_participants.source_type = 'proposal'`,
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
  payload: { eventId: string; userId: string },
): StatementLike {
  return db
    .prepare(
      `UPDATE event_participants
       SET status = 'inactive', updated_at = ?
       WHERE event_id = ? AND user_id = ? AND source_type = 'proposal'`,
    )
    .bind(nowIso(), payload.eventId, payload.userId);
}

async function listProposalParticipantProjectionAfterChange(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    sourceRef: string;
    nextRole?: ProposalSpeakerRole;
    nextStatus: "active" | "inactive";
  },
): Promise<ProposalParticipantProjection[]> {
  const sources = await all<{
    proposal_id: string;
    role: ProposalSpeakerRole;
    proposal_status: string;
    speaker_status: string;
  }>(
    db,
    `SELECT ps.proposal_id, ps.role, sp.status AS proposal_status, ps.status AS speaker_status
     FROM proposal_speakers ps
     JOIN session_proposals sp ON sp.id = ps.proposal_id
     WHERE sp.event_id = ? AND ps.user_id = ?
       AND sp.deleted_at IS NULL AND ps.proposal_id <> ?
     ORDER BY ps.proposal_id ASC`,
    [payload.eventId, payload.userId, payload.sourceRef],
  );
  if (payload.nextStatus === "active" && payload.nextRole) {
    sources.push({
      proposal_id: payload.sourceRef,
      role: payload.nextRole,
      proposal_status: "accepted",
      speaker_status: "confirmed",
    });
  } else if (payload.nextRole) {
    sources.push({
      proposal_id: payload.sourceRef,
      role: payload.nextRole,
      proposal_status: "submitted",
      speaker_status: "declined",
    });
  }

  const byParticipantRole = new Map<string, ProposalParticipantProjection>();
  for (const source of sources) {
    const participant = participantRoleForProposalRole(source.role);
    const key = `${participant.role}\u0000${participant.subrole ?? ""}`;
    const current = byParticipantRole.get(key);
    const status =
      source.proposal_status === "accepted" && source.speaker_status !== "declined" ? "active" : "inactive";
    if (
      !current ||
      (status === "active" && current.status !== "active") ||
      (status === current.status && source.proposal_id < current.sourceRef)
    ) {
      byParticipantRole.set(key, { ...participant, sourceRef: source.proposal_id, proposalRole: source.role, status });
    }
  }
  return Array.from(byParticipantRole.values());
}

/**
 * Rebuilds the proposal-owned event-participant projection for one person.
 *
 * The base table deliberately has one row per event/user/role/subrole, so it
 * cannot be a ledger of every accepted proposal source. The authoritative
 * source ledger is proposal_speakers joined to accepted session_proposals;
 * this composite rebuild selects one deterministic source reference for each
 * projected role and preserves every other accepted source in the process.
 */
export async function prepareProposalParticipantProjectionWithCapacity(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    sourceRef: string;
    nextRole?: ProposalSpeakerRole;
    nextStatus: "active" | "inactive";
    sourceRevisionAdvance?: 0 | 1;
  },
): Promise<StatementLike[]> {
  // Read the revision before reading the source set. If another proposal
  // changes after this point, the post-mutation guard below rejects this
  // otherwise stale projection rebuild atomically.
  const sourceRevision = await getEventParticipantSourceRevision(db, payload.eventId, payload.userId);
  const projection = await listProposalParticipantProjectionAfterChange(db, payload);
  return [
    prepareEventParticipantSourceRevisionGuard(db, {
      eventId: payload.eventId,
      userId: payload.userId,
      expectedRevision: sourceRevision + (payload.sourceRevisionAdvance ?? 1),
    }),
    prepareDeactivateProposalParticipantRoles(db, payload),
    ...projection.map((participant) =>
      prepareUpsertProposalParticipant(db, {
        eventId: payload.eventId,
        userId: payload.userId,
        proposalRole: participant.proposalRole,
        sourceRef: participant.sourceRef,
        status: participant.status,
      }),
    ),
    ...(await prepareRoleCapacityReconciliationStatements(db, {
      eventId: payload.eventId,
      userId: payload.userId,
      activeProposalRoles: projection
        .filter((participant) => participant.status === "active")
        .map((participant) => participant.role),
    })),
  ];
}

export async function prepareSyncProposalParticipantRoleWithCapacity(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    proposalRole: ProposalSpeakerRole;
    sourceRef: string;
    status: "active" | "inactive";
    sourceRevisionAdvance?: 0 | 1;
  },
): Promise<StatementLike[]> {
  return prepareProposalParticipantProjectionWithCapacity(db, {
    eventId: payload.eventId,
    userId: payload.userId,
    sourceRef: payload.sourceRef,
    nextRole: payload.proposalRole,
    nextStatus: payload.status,
    sourceRevisionAdvance: payload.sourceRevisionAdvance,
  });
}

export async function prepareDeactivateProposalParticipantRolesWithCapacity(
  db: DatabaseLike,
  payload: { eventId: string; userId: string; sourceRef: string; sourceRevisionAdvance?: 0 | 1 },
): Promise<StatementLike[]> {
  return prepareProposalParticipantProjectionWithCapacity(db, { ...payload, nextStatus: "inactive" });
}

export async function prepareProposalParticipantSourceCapacityStatements(
  db: DatabaseLike,
  payload: { eventId: string; sourceRef: string; nextStatus: "active" | "inactive" },
): Promise<StatementLike[]> {
  // Read before the roster query. A whole-proposal status mutation does not
  // itself alter this roster, so its guard expects the same revision.
  const rosterRevision = await getProposalSpeakerRosterRevision(db, payload.sourceRef);
  const speakers = await all<{ user_id: string; role: ProposalSpeakerRole; status: string }>(
    db,
    "SELECT user_id, role, status FROM proposal_speakers WHERE proposal_id = ?",
    [payload.sourceRef],
  );
  const statements: StatementLike[] = [
    prepareProposalSpeakerRosterRevisionGuard(db, {
      proposalId: payload.sourceRef,
      expectedRevision: rosterRevision,
    }),
  ];
  for (const speaker of speakers) {
    statements.push(
      ...(await prepareProposalParticipantProjectionWithCapacity(db, {
        eventId: payload.eventId,
        userId: speaker.user_id,
        sourceRef: payload.sourceRef,
        nextRole: speaker.role,
        nextStatus: payload.nextStatus === "active" && speaker.status !== "declined" ? "active" : "inactive",
      })),
    );
  }
  return statements;
}
