import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type {
  LiveCreditIdentity,
  LiveSpeakerCandidate,
  liveSpeakerCandidatesQuerySchema,
} from "../../../../assets/shared/schemas/live-session-credit";
import type { z } from "zod";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { personDisplayNameSql } from "../people/person-name-sql";
import { identityJobTitleSql, identityOrganizationNameSql } from "../identities/affiliation-projection";
import { creditedIdentityIdSql } from "../event-agenda/credited-identity";
import { publicUserHeadshotPath } from "../user-headshot";
import { livePersonHeadshotSql } from "./live-person-photo";

/**
 * Lower thirds read a person's capacity from the identity they act as, and
 * from nothing else: its job title and its organization, as the identity has
 * them now. These are the live room's reads of identities.
 */

const ACTIVE_IDENTITY = "identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL";

type IdentityRow = { id: string; title: string | null; organization: string | null };

function identityOf(row: IdentityRow | undefined): LiveCreditIdentity | null {
  const title = row?.title?.trim() || null;
  const organization = row?.organization?.trim() || null;
  return title || organization ? { title, organization } : null;
}

/**
 * The capacity of each identity named, and of the identity each credited person
 * speaks as where no approved appearance names one — the agenda's one rule
 * (`creditedIdentityIdSql`): their choice on the session's accepted proposal,
 * else their primary identity. Identity id → capacity, user id → its identity.
 */
export async function readLiveCreditIdentities(
  db: DatabaseLike,
  identityIds: readonly string[],
  credited?: { occurrenceId: string; userIds: readonly string[] },
): Promise<{ identities: Map<string, LiveCreditIdentity | null>; primary: Map<string, string> }> {
  const primary = new Map<string, string>();
  if (credited?.userIds.length) {
    const rows = await all<{ user_id: string; identity_id: string | null }>(
      db,
      `SELECT person.id AS user_id, ${creditedIdentityIdSql("?", "person.id")} AS identity_id
         FROM users person WHERE person.id IN (SELECT value FROM json_each(?))`,
      [credited.occurrenceId, JSON.stringify([...new Set(credited.userIds)])],
    );
    for (const row of rows) if (row.identity_id) primary.set(row.user_id, row.identity_id);
  }
  const ids = [...new Set([...identityIds, ...primary.values()])];
  const identities = new Map<string, LiveCreditIdentity | null>();
  if (ids.length) {
    const rows = await all<IdentityRow>(
      db,
      `SELECT identity.id, ${identityJobTitleSql("identity.id")} AS title,
              ${identityOrganizationNameSql("identity.id")} AS organization
         FROM identities identity WHERE identity.id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(ids)],
    );
    for (const row of rows) identities.set(row.id, identityOf(row));
  }
  return { identities, primary };
}

/** One person, as one of their active identities or as themselves, for an added lower third. */
export async function readLiveCandidate(
  db: DatabaseLike,
  userId: string,
  identityId: string | null,
): Promise<{ name: string; photoUrl: string | null; identity: LiveCreditIdentity | null } | null> {
  const row = await first<{ name: string; headshot_r2_key: string | null; owned: number }>(
    db,
    `SELECT ${personDisplayNameSql("person", "Guest")} AS name, ${livePersonHeadshotSql("person")} AS headshot_r2_key,
            CASE WHEN ? IS NULL THEN 1 ELSE EXISTS(SELECT 1 FROM identities identity
              WHERE identity.id = ? AND identity.user_id = person.id AND ${ACTIVE_IDENTITY}) END AS owned
       FROM users person WHERE person.id = ? AND person.active = 1`,
    [identityId, identityId, userId],
  );
  if (!row || !row.owned) return null;
  const identity = identityId ? (await readLiveCreditIdentities(db, [identityId])).identities.get(identityId) : null;
  return { name: row.name, photoUrl: publicUserHeadshotPath(userId, row.headshot_r2_key), identity: identity ?? null };
}

/**
 * The event's people a lower third can name, one result per active identity:
 * someone who speaks for two organizations is found twice, each with its own
 * title. People with no active identity are found once, as themselves. The
 * event's people are its proposal speakers, credited speakers, team and
 * registered attendees.
 */
export async function searchLiveSpeakerCandidates(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof liveSpeakerCandidatesQuerySchema>,
  now: string,
  scope: "event" | "directory" = "event",
): Promise<{ identities: LiveSpeakerCandidate[]; page: ReturnType<typeof buildPageInfo> }> {
  if (scope === "directory" && (query.q?.trim().length ?? 0) < 2)
    return { identities: [], page: buildPageInfo(query.limit, query.offset, 0, 0) };
  const membership =
    scope === "directory"
      ? "1=1"
      : `EXISTS(SELECT 1 FROM proposal_speakers speaker JOIN session_proposals proposal ON proposal.id = speaker.proposal_id
                    WHERE speaker.user_id = person.id AND proposal.event_id = ?1)
         OR EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers credited JOIN event_agenda_occurrences occurrence ON occurrence.id = credited.occurrence_id
                    WHERE credited.user_id = person.id AND occurrence.event_id = ?1)
         OR EXISTS(SELECT 1 FROM user_roles role WHERE role.user_id = person.id AND role.context_type = 'event' AND role.context_id = ?1
                    AND role.revoked_at IS NULL AND (role.expires_at IS NULL OR role.expires_at > ?2))
         OR EXISTS(SELECT 1 FROM registrations registration WHERE registration.user_id = person.id AND registration.event_id = ?1
                    AND registration.status = 'registered')`;
  const people = `SELECT person.id, ${personDisplayNameSql("person", "Guest")} AS name, ${livePersonHeadshotSql("person")} AS headshot_r2_key
      FROM users person
     WHERE person.active = 1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
       AND (${membership})`;
  const options = `SELECT people.id AS user_id, people.name, people.headshot_r2_key, identity.id AS identity_id,
         ${identityJobTitleSql("identity.id")} AS title, ${identityOrganizationNameSql("identity.id")} AS organization
      FROM (${people}) people
      LEFT JOIN identities identity ON identity.user_id = people.id AND ${ACTIVE_IDENTITY}`;
  const search = query.q
    ? "WHERE INSTR(LOWER(options.name || ' ' || COALESCE(options.organization, '')), LOWER(?)) > 0"
    : "";
  const values = [...(scope === "event" ? [eventId, now] : []), ...(query.q ? [query.q] : [])];
  const total = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM (${options}) options ${search}`,
    values,
  );
  const direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  const rows = await all<{
    user_id: string;
    name: string;
    headshot_r2_key: string | null;
    identity_id: string | null;
    title: string | null;
    organization: string | null;
  }>(
    db,
    `SELECT options.user_id, options.name, options.headshot_r2_key, options.identity_id, options.title, options.organization
       FROM (${options}) options ${search}
      ORDER BY options.name ${direction}, options.organization IS NULL, options.organization, options.user_id, options.identity_id
      LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  return {
    identities: rows.map((row) => ({
      userId: row.user_id,
      identityId: row.identity_id,
      name: row.name,
      photoUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
      title: row.title?.trim() || null,
      organization: row.organization?.trim() || null,
    })),
    page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, rows.length),
  };
}
