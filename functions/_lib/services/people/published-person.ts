/**
 * A person's contributions beyond the agenda, read once from canonical data:
 * their identities (every one, ended ones as past, unless staff withheld it),
 * the group seats and leadership terms their groups publish, and their
 * candidacies in public elections. The publication
 * snapshot and the owner's portal view both read through here, so the two
 * never apply different rules.
 */
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { utcInstantSchema } from "../../../../assets/shared/schemas/api-common";
import { personIdentityVisibility, publicPersonIdentities } from "../../../../assets/shared/person-profile-policy";
import {
  publishedPersonSchema,
  type PersonGroupRole,
  type PersonProfileAudience,
  type PublishedPerson,
} from "../../../../assets/shared/schemas/person-profile";
import { identityJobTitleSql } from "../identities/affiliation-projection";
import { LEADERSHIP_TERM_SELECT_SQL } from "../groups/leadership-sql";
import { readAgendaSpeakerOrganizations } from "../event-agenda/speaker-organizations";
import { personDisplayNameSql } from "./person-name-sql";

const BATCH = 50;
const DEFAULT_SEAT_TITLE = "Member";

interface IdentityRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  started_at: string;
  ended_at: string | null;
  hidden_from_public_profile: number;
}

interface GroupRow {
  user_id: string;
  group_slug: string;
  group_name: string;
  title: string;
  leadership: number;
  starts_at: string | null;
  ends_at: string | null;
  active: number;
}

interface CandidacyRow {
  user_id: string;
  vote_slug: string;
  vote_title: string;
  owner_group_name: string | null;
  closes_at: string;
}

const instant = (value: string | null) => (value && utcInstantSchema.safeParse(value).success ? value : null);

interface AccountRow {
  id: string;
  name: string;
  slug: string | null;
}

/** Each live account's display name and current profile address, if it holds one. */
function readAccounts(db: DatabaseLike, userIds: string) {
  return all<AccountRow>(
    db,
    `SELECT person.id, ${personDisplayNameSql("person", "Member")} AS name, address.slug
       FROM users person
       LEFT JOIN person_profile_slugs address ON address.user_id = person.id AND address.retired_at IS NULL
      WHERE person.id IN (SELECT value FROM json_each(?))
        AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL`,
    [userIds],
  );
}

/** Active identities first, the one marked as the person's default leading, then most recently started. */
function readIdentities(db: DatabaseLike, userIds: string) {
  return all<IdentityRow>(
    db,
    `SELECT identity.id, identity.user_id, identity.organization_id,
            ${identityJobTitleSql("identity.id")} AS job_title,
            identity.biography, identity.links_json, identity.started_at, identity.ended_at,
            identity.hidden_from_public_profile
       FROM identities identity
      WHERE identity.user_id IN (SELECT value FROM json_each(?))
        AND identity.started_at IS NOT NULL AND identity.blocked_at IS NULL
      ORDER BY identity.user_id, identity.ended_at IS NOT NULL, identity.is_default DESC,
               identity.started_at DESC, identity.id`,
    [userIds],
  );
}

/** Leadership terms in groups that publish their leadership; the caller selects from `ur`, `g` and `gt`. */
export const PUBLIC_LEADERSHIP_SOURCE_SQL = `FROM user_roles ur
       JOIN groups g ON g.id = ur.context_id AND g.active = 1 AND g.public_leadership = 1
       JOIN group_types gt ON gt.key = g.type_key
      WHERE ur.context_type = 'group' AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')`;
/** Seats in groups that publish their roster; the caller selects from `membership` and `g`. */
export const PUBLIC_SEAT_SOURCE_SQL = `FROM group_memberships membership
       JOIN groups g ON g.id = membership.group_id
      WHERE g.active = 1 AND g.public_roster = 1`;
/** Candidacies in public elections that were not cancelled; the caller selects from `candidate`, `vote` and `owner`. */
export const PUBLIC_CANDIDACY_SOURCE_SQL = `FROM vote_candidates candidate
       JOIN votes vote ON vote.id = candidate.vote_id
       LEFT JOIN groups owner ON owner.id = vote.owner_group_id
      WHERE vote.visibility = 'public' AND vote.vote_type = 'election' AND vote.cancelled_at IS NULL`;

/** Local leadership terms in groups that publish leadership, and seats in groups that publish their roster. */
function readGroups(db: DatabaseLike, userIds: string) {
  return all<GroupRow>(
    db,
    `SELECT ur.user_id, g.slug AS group_slug, g.name AS group_name, 1 AS leadership, ${LEADERSHIP_TERM_SELECT_SQL}
       ${PUBLIC_LEADERSHIP_SOURCE_SQL}
        AND ur.user_id IN (SELECT value FROM json_each(?))
     UNION ALL
     SELECT membership.user_id, g.slug, g.name, 0,
            CASE WHEN membership.left_at IS NOT NULL THEN COALESCE(membership.title, ?) ELSE ? END,
            membership.joined_at, membership.left_at, CASE WHEN membership.left_at IS NULL THEN 1 ELSE 0 END
       ${PUBLIC_SEAT_SOURCE_SQL}
        AND membership.user_id IN (SELECT value FROM json_each(?))
      ORDER BY 1, 2, 6`,
    [userIds, DEFAULT_SEAT_TITLE, DEFAULT_SEAT_TITLE, userIds],
  );
}

/** Candidacies in public elections that were not cancelled: each such vote has its own public page. */
function readCandidacies(db: DatabaseLike, userIds: string) {
  return all<CandidacyRow>(
    db,
    `SELECT candidate.user_id, vote.slug AS vote_slug, vote.title AS vote_title,
            owner.name AS owner_group_name, vote.closes_at
       ${PUBLIC_CANDIDACY_SOURCE_SQL}
        AND candidate.user_id IN (SELECT value FROM json_each(?))
      ORDER BY candidate.user_id, vote.closes_at DESC, vote.slug`,
    [userIds],
  );
}

/**
 * Current roles first, then the most recently started. A current leadership
 * title already names the seat it is held through, so that seat is not listed twice.
 */
function groupRoles(roles: PersonGroupRole[]): PersonGroupRole[] {
  const led = new Set(roles.filter((role) => role.leadership && role.endsAt === null).map((role) => role.groupSlug));
  return roles
    .filter((role) => role.leadership || role.endsAt !== null || !led.has(role.groupSlug))
    .sort(
      (a, b) =>
        Number(a.endsAt !== null) - Number(b.endsAt !== null) ||
        (b.startsAt ?? "").localeCompare(a.startsAt ?? "") ||
        a.groupName.localeCompare(b.groupName),
    );
}

/**
 * Each person's contributions. The public audience never receives a hidden
 * identity; the owner's receives every identity, marked with its visibility.
 */
export async function readPublishedPeople(
  db: DatabaseLike,
  userIds: readonly string[],
  audience: PersonProfileAudience,
): Promise<Record<string, PublishedPerson>> {
  const people: Record<string, PublishedPerson> = {};
  const ids = [...new Set(userIds)].sort();
  for (let offset = 0; offset < ids.length; offset += BATCH) {
    const batch = JSON.stringify(ids.slice(offset, offset + BATCH));
    const [accounts, identities, groups, candidacies] = await Promise.all([
      readAccounts(db, batch),
      readIdentities(db, batch),
      readGroups(db, batch),
      readCandidacies(db, batch),
    ]);
    const organizations = await readAgendaSpeakerOrganizations(db, [
      ...new Set(identities.flatMap((row) => (row.organization_id ? [row.organization_id] : []))),
    ]);
    // Only a live account has a profile; rows of a merged or erased one are left out.
    for (const account of accounts)
      people[account.id] = { name: account.name, slug: account.slug, identities: [], groups: [], candidacies: [] };
    for (const row of identities) {
      const organization = row.organization_id ? organizations[row.organization_id] : undefined;
      people[row.user_id]?.identities.push({
        id: row.id,
        title: row.job_title?.trim() || null,
        organizationId: row.organization_id,
        organizationName: organization?.name ?? null,
        organizationLogoUrl: organization?.logoUrl ?? null,
        startedAt: instant(row.started_at),
        endedAt: instant(row.ended_at),
        biography: row.biography?.trim() ?? "",
        links: parseLinksJson(row.links_json),
        visibility: personIdentityVisibility({ hiddenFromPublicProfile: row.hidden_from_public_profile === 1 }),
      });
    }
    for (const row of groups)
      people[row.user_id]?.groups.push({
        groupSlug: row.group_slug,
        groupName: row.group_name,
        title: row.title,
        leadership: row.leadership === 1,
        startsAt: instant(row.starts_at),
        endsAt: row.active === 1 ? null : instant(row.ends_at),
      });
    for (const row of candidacies)
      people[row.user_id]?.candidacies.push({
        voteSlug: row.vote_slug,
        voteTitle: row.vote_title,
        ownerGroupName: row.owner_group_name ?? "",
        closesAt: row.closes_at,
      });
  }
  for (const [userId, entry] of Object.entries(people))
    people[userId] = publishedPersonSchema.parse({
      name: entry.name,
      slug: entry.slug,
      identities: audience === "owner" ? entry.identities : publicPersonIdentities(entry.identities),
      groups: groupRoles(entry.groups),
      candidacies: entry.candidacies,
    });
  return people;
}
