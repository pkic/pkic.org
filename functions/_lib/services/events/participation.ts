import {
  eventParticipationSchema,
  type EventParticipation,
} from "../../../../assets/shared/schemas/event-participation";
import { all } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import type { DatabaseLike } from "../../types";

export async function fetchEventParticipation(db: DatabaseLike, userId: string | null, eventIds: readonly string[]) {
  const result = new Map<string, EventParticipation>();
  if (!userId || !eventIds.length) return result;
  const filter = buildD1JsonMembershipFilter("e.id", eventIds);
  const rows = await all<{
    id: string;
    registrationId: string | null;
    registrationStatus: string | null;
    proposalStates: string;
    speakerStates: string;
    proposals: number;
    speakerProposals: number;
  }>(
    db,
    `SELECT e.id, r.id AS registrationId, r.status AS registrationStatus,
      (SELECT group_concat(DISTINCT p.status) FROM session_proposals p WHERE p.event_id = e.id AND p.deleted_at IS NULL AND p.proposer_user_id = ?) AS proposalStates,
      (SELECT group_concat(DISTINCT ps.status) FROM proposal_speakers ps JOIN session_proposals p ON p.id = ps.proposal_id AND p.deleted_at IS NULL WHERE p.event_id = e.id AND ps.user_id = ?) AS speakerStates,
      (SELECT COUNT(*) FROM session_proposals p WHERE p.event_id = e.id AND p.deleted_at IS NULL
        AND p.proposer_user_id = ?) AS proposals,
      (SELECT COUNT(*) FROM proposal_speakers ps JOIN session_proposals p
        ON p.id = ps.proposal_id AND p.deleted_at IS NULL WHERE p.event_id = e.id AND ps.user_id = ?) AS speakerProposals
      FROM events e LEFT JOIN registrations r ON r.event_id = e.id AND r.user_id = ?
      WHERE ${filter.sql}`,
    [userId, userId, userId, userId, userId, ...filter.bindings],
  );
  for (const row of rows)
    result.set(
      row.id,
      eventParticipationSchema.parse({
        ...row,
        proposalStates: row.proposalStates?.split(",") ?? [],
        speakerStates: row.speakerStates?.split(",") ?? [],
      }),
    );
  return result;
}
