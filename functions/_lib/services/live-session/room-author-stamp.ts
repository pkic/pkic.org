import {
  liveAuthorRoleForCredit,
  liveAuthorRoleForDuty,
  orderLiveAuthorRoles,
  type LiveAuthorRole,
} from "../../../../assets/shared/live-author-roles";
import {
  liveAuthorAffiliationSchema,
  type LiveAuthorAffiliation,
  type LiveAuthorStamp,
} from "../../../../assets/shared/schemas/live-session-author";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { ACTIVE_LEADERSHIP_PREDICATE_SQL } from "../groups/leadership-sql";
import { identityJobTitleSql } from "../identities/affiliation-projection";
import { organizationLogoUrl } from "../organization-content/fields";
import { PUBLIC_LEADERSHIP_SOURCE_SQL } from "../people/published-person";
import type { LiveRoomParticipant } from "./room-admission";

interface StampRow {
  title: string | null;
  organization: string | null;
  organization_id: string | null;
  logo: string | null;
  member: number;
  organizer: number;
  credit_roles: string;
  duties: string;
  leadership: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * One statement for everything a room shows about who is writing, each part
 * a fact the site or the event already shows: the acting identity's title and
 * organization (and whether that organization, or the person, is a member),
 * the organizer role of this event, credits on this event's published agenda,
 * duties the agenda shows, and leadership of groups that publish it.
 */
const STAMP_SQL = `SELECT
  (SELECT ${identityJobTitleSql("acting.id")}) AS title,
  current.name AS organization, current.id AS organization_id, current.logo_r2_key AS logo,
  EXISTS(SELECT 1 FROM members member WHERE member.status = 'active' AND (
      (acting.organization_id IS NOT NULL AND member.member_type = 'organization' AND member.organization_id = acting.organization_id)
      OR (acting.organization_id IS NULL AND member.member_type = 'individual' AND member.identity_id = acting.id))) AS member,
  EXISTS(SELECT 1 FROM user_roles organizer WHERE organizer.user_id = person.id AND organizer.role_id = 'role-event_organizer'
      AND organizer.context_type = 'event' AND organizer.context_id = ? AND organizer.revoked_at IS NULL
      AND (organizer.expires_at IS NULL OR organizer.expires_at > ${NOW})) AS organizer,
  (SELECT json_group_array(DISTINCT COALESCE(json_extract(credit.value, '$.role'), 'speaker'))
     FROM event_agenda_state state
     JOIN event_agenda_published_occurrences approved ON approved.event_id = state.event_id AND approved.revision = state.published_revision,
          json_each(approved.payload_json, '$.speakers') credit
    WHERE state.event_id = ? AND json_extract(credit.value, '$.userId') = person.id) AS credit_roles,
  (SELECT json_group_array(DISTINCT duty.name) FROM event_agenda_assignments assignment
     JOIN event_agenda_staffing_roles duty ON duty.event_id = assignment.event_id AND duty.id = assignment.role
    WHERE assignment.event_id = ? AND assignment.user_id = person.id AND duty.show_on_agenda = 1) AS duties,
  (SELECT json_group_array(DISTINCT ur.role_id) ${PUBLIC_LEADERSHIP_SOURCE_SQL}
      AND ur.user_id = person.id AND ${ACTIVE_LEADERSHIP_PREDICATE_SQL}) AS leadership
  FROM users person
  LEFT JOIN identities acting ON acting.id = ? AND acting.user_id = person.id AND acting.ended_at IS NULL
       AND acting.blocked_at IS NULL AND acting.hidden_from_public_profile = 0
  LEFT JOIN organizations named ON named.id = acting.organization_id
  LEFT JOIN organizations current ON current.id = COALESCE(named.merged_into_organization_id, named.id)
 WHERE person.id = ?`;

function strings(json: string): string[] {
  const parsed: unknown = JSON.parse(json || "[]");
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

function affiliationOf(row: StampRow): LiveAuthorAffiliation | null {
  if (!row.title && !row.organization) return null;
  const logo = row.organization_id ? organizationLogoUrl(row.organization_id, row.logo) : null;
  const parsed = liveAuthorAffiliationSchema.safeParse({
    ...(row.title ? { title: row.title } : {}),
    ...(row.organization ? { organization: { name: row.organization, ...(logo ? { logoSrc: logo } : {}) } } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** Who the person is as they write: their acting capacity and the roles the room recognizes, frozen with it. */
export async function readLiveAuthorStamp(
  db: DatabaseLike,
  eventId: string,
  viewer: LiveRoomParticipant,
): Promise<LiveAuthorStamp> {
  if (!viewer.userId) return { affiliation: null, roles: [] };
  const row = await first<StampRow>(db, STAMP_SQL, [
    eventId,
    eventId,
    eventId,
    viewer.actingIdentityId ?? null,
    viewer.userId,
  ]);
  if (!row) return { affiliation: null, roles: [] };
  const roles: LiveAuthorRole[] = [];
  if (viewer.role === "operator" || row.organizer === 1) roles.push("event_team");
  for (const role of strings(row.credit_roles)) {
    const recognized = liveAuthorRoleForCredit(role);
    if (recognized) roles.push(recognized);
  }
  for (const duty of strings(row.duties)) roles.push(liveAuthorRoleForDuty(duty));
  const leadership = strings(row.leadership);
  if (leadership.includes("role-group_lead")) roles.push("chair");
  if (leadership.includes("role-group_deputy_lead")) roles.push("vice_chair");
  if (row.member === 1) roles.push("member");
  return { affiliation: affiliationOf(row), roles: orderLiveAuthorRoles(roles) };
}
