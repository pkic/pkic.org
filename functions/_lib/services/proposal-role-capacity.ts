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

export interface ProposalRoleMapping {
  role: EventParticipantRole;
  subrole: string | null;
}

interface ProposalRoleSourceState extends ProposalRoleMapping {
  sourceRef: string;
  proposalRole: ProposalSpeakerRole;
  status: "active" | "inactive";
}

export function participantRoleForProposalRole(role: ProposalSpeakerRole): ProposalRoleMapping {
  switch (role) {
    case "moderator":
      return { role: "moderator", subrole: null };
    case "panelist":
      return { role: "panelist", subrole: null };
    case "proposer":
    case "speaker":
    case "co_speaker":
      return { role: "speaker", subrole: role };
    default: {
      const unsupportedRole: never = role;
      throw new Error(`Unsupported proposal participant role: ${String(unsupportedRole)}`);
    }
  }
}

export function proposalParticipantStatus(proposalStatus: string, speakerStatus: string): "active" | "inactive" {
  return proposalStatus === "accepted" && speakerStatus !== "declined" ? "active" : "inactive";
}

async function listProposalRoleSourcesAfterChange(
  db: DatabaseLike,
  payload: {
    eventId: string;
    userId: string;
    sourceRef: string;
    nextRole?: ProposalSpeakerRole;
    nextStatus: "active" | "inactive";
  },
): Promise<ProposalRoleSourceState[]> {
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

  const byParticipantRole = new Map<string, ProposalRoleSourceState>();
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
 * Reconciles registration capacity after one proposal-role source changes.
 * Proposal roles are read directly from proposal_speakers/session_proposals;
 * event_participants remains the direct-role source and is never rebuilt.
 */
export async function prepareProposalRoleCapacityAfterSourceChange(
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
  const sources = await listProposalRoleSourcesAfterChange(db, payload);
  return [
    prepareEventParticipantSourceRevisionGuard(db, {
      eventId: payload.eventId,
      userId: payload.userId,
      expectedRevision: sourceRevision + (payload.sourceRevisionAdvance ?? 1),
    }),
    ...(await prepareRoleCapacityReconciliationStatements(db, {
      eventId: payload.eventId,
      userId: payload.userId,
      activeProposalRoles: sources
        .filter((participant) => participant.status === "active")
        .map((participant) => participant.role),
    })),
  ];
}

export async function prepareProposalRoleCapacityForSpeakerChange(
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
  return prepareProposalRoleCapacityAfterSourceChange(db, {
    eventId: payload.eventId,
    userId: payload.userId,
    sourceRef: payload.sourceRef,
    nextRole: payload.proposalRole,
    nextStatus: payload.status,
    sourceRevisionAdvance: payload.sourceRevisionAdvance,
  });
}

export async function prepareProposalRoleCapacityForSpeakerRemoval(
  db: DatabaseLike,
  payload: { eventId: string; userId: string; sourceRef: string; sourceRevisionAdvance?: 0 | 1 },
): Promise<StatementLike[]> {
  return prepareProposalRoleCapacityAfterSourceChange(db, { ...payload, nextStatus: "inactive" });
}

export async function prepareProposalRoleCapacityForProposalStatus(
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
      ...(await prepareProposalRoleCapacityAfterSourceChange(db, {
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
