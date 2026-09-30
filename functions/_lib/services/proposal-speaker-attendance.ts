import { proposalSpeakerEffectiveProfileExpression } from "./proposal-speakers";
import { buildD1JsonMembershipFilter } from "../db/json-membership";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import type { ProposalSpeakerAttendance } from "../../../assets/shared/schemas/event-proposals";
import { loadRegistrationDayStates } from "./registrations/day-states";

/** Loads only the speakers belonging to the current proposal page. */
export async function loadProposalSpeakerAttendance(db: DatabaseLike, proposalIds: readonly string[]) {
  const result = new Map<string, ProposalSpeakerAttendance[]>();
  if (!proposalIds.length) return result;
  const filter = buildD1JsonMembershipFilter("ps.proposal_id", proposalIds);
  const rows = await all<Omit<ProposalSpeakerAttendance, "days"> & { proposalId: string }>(
    db,
    `SELECT ps.proposal_id AS proposalId, ps.user_id AS userId, ps.status,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "firstName", "first_name")} AS firstName,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "lastName", "last_name")} AS lastName,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "organizationName", "organization_name")} AS organizationName,
            r.id AS registrationId, r.status AS registrationStatus, r.attendance_type AS attendanceType
       FROM proposal_speakers ps
       JOIN session_proposals sp ON sp.id = ps.proposal_id
       JOIN users u ON u.id = ps.user_id
       LEFT JOIN registrations r ON r.event_id = sp.event_id AND r.user_id = ps.user_id
      WHERE ${filter.sql}
      ORDER BY ps.proposal_id, ps.created_at, ps.id`,
    filter.bindings,
  );
  const days = await loadRegistrationDayStates(
    db,
    rows.flatMap((row) => (row.registrationId ? [row.registrationId] : [])),
  );
  for (const { proposalId, ...row } of rows) {
    const speakers = result.get(proposalId) ?? [];
    speakers.push({ ...row, days: row.registrationId ? (days.get(row.registrationId) ?? []) : [] });
    result.set(proposalId, speakers);
  }
  return result;
}
