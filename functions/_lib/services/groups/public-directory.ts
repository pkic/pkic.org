/**
 * The public face of a group: mailing list, published leadership with titles
 * and tenures, and, for groups that publish it, the dated member roster with
 * its history. Working groups publish chairs; the Board of Directors and the
 * Executive Council also publish their seats. One projection serves all.
 */
import type {
  GroupDirectoryResponse,
  PublicGroupLeadershipAssignment,
  PublicGroupRosterEntry,
} from "../../../../assets/shared/schemas/group-directory";
import type { GroupLeadershipRoleId } from "../../../../assets/shared/schemas/groups";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { toPublicRoleProfile, type PublicRoleProfileRow } from "../membership/public-role-profile";
import { EFFECTIVE_GROUP_LINEAGE_CTE } from "./governance";
import { LEADERSHIP_TERM_SELECT_SQL } from "./leadership";
import { getVisibleGroup } from "./read-model";

const DEFAULT_SEAT_TITLE = "Member";

interface PublicTenureRow extends PublicRoleProfileRow {
  title: string;
  starts_at: string;
  ends_at: string | null;
}

interface PublicLeadershipRow extends PublicTenureRow {
  role_id: GroupLeadershipRoleId;
  source_group_id: string;
  source_group_slug: string;
  source_group_name: string;
  source_group_type_key: string;
  source_group_type_singular_label: string;
  source_group_type_plural_label: string;
  source_group_visibility: string;
  depth: number;
}

/** The public person columns, from the exact identity a tenure was held through. */
const PUBLIC_PROFILE_SELECT_SQL = `
  u.first_name, u.last_name,
  CASE WHEN identity.organization_id IS NULL THEN category.label ELSE identity.job_title END AS job_title,
  o.id AS org_id, o.name AS org_name,
  o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
  identity.id AS identity_id,
  u.headshot_r2_key,
  identity.links_json`;

const SOURCE_GROUP_SELECT_SQL = `
  source_group.id AS source_group_id,
  source_group.slug AS source_group_slug,
  source_group.name AS source_group_name,
  source_group.type_key AS source_group_type_key,
  gt.singular_label AS source_group_type_singular_label,
  gt.plural_label AS source_group_type_plural_label,
  source_group.visibility AS source_group_visibility`;

const PUBLIC_ORDER_SQL = `LOWER(COALESCE(u.last_name, '')), LOWER(COALESCE(u.first_name, '')), u.id`;

async function requirePublicGroup(db: DatabaseLike, idOrSlug: string) {
  const group = await getVisibleGroup(db, idOrSlug, {});
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not publicly visible");
  return group;
}

function toPublicLeadership(row: PublicLeadershipRow): PublicGroupLeadershipAssignment {
  return {
    roleId: row.role_id,
    person: toPublicRoleProfile(row),
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sourceGroup:
      row.source_group_visibility === "public"
        ? {
            id: row.source_group_id,
            slug: row.source_group_slug,
            name: row.source_group_name,
            type: {
              key: row.source_group_type_key,
              singularLabel: row.source_group_type_singular_label,
              pluralLabel: row.source_group_type_plural_label,
            },
          }
        : null,
    inherited: row.depth > 0,
  };
}

function toPublicTenure(row: PublicTenureRow): PublicGroupRosterEntry {
  return { person: toPublicRoleProfile(row), title: row.title, startsAt: row.starts_at, endsAt: row.ends_at };
}

/** Effective leadership now, each through a live capacity, leads first. */
function listCurrentLeadership(db: DatabaseLike, groupId: string): Promise<PublicLeadershipRow[]> {
  return all<PublicLeadershipRow>(
    db,
    `${EFFECTIVE_GROUP_LINEAGE_CTE}
     SELECT ur.role_id, ${PUBLIC_PROFILE_SELECT_SQL}, ${LEADERSHIP_TERM_SELECT_SQL}, ${SOURCE_GROUP_SELECT_SQL},
            lineage.depth
       FROM effective_lineage lineage
       JOIN groups source_group ON source_group.id = lineage.id
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN user_roles ur
         ON ur.context_type = 'group'
        AND ur.context_id = lineage.id
        AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
        AND ur.revoked_at IS NULL
        AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       JOIN users u ON u.id = ur.user_id AND u.active = 1
       JOIN group_memberships membership
         ON membership.group_id = source_group.id
        AND membership.user_id = ur.user_id
        AND membership.member_id = ur.member_id
        AND membership.left_at IS NULL
       JOIN members represented_member ON represented_member.id = membership.member_id
        AND represented_member.status = 'active'
       JOIN identities identity ON identity.id = membership.identity_id
        AND identity.user_id = ur.user_id
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
        AND capacity.member_id = represented_member.id
       JOIN membership_categories category ON category.code = capacity.membership_category
       LEFT JOIN organizations o ON o.id = represented_member.organization_id
      ORDER BY lineage.depth,
               CASE ur.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END,
               ${PUBLIC_ORDER_SQL}`,
    [groupId],
  );
}

/**
 * Closed local terms, most recently ended first, attributed to the identity
 * and Member each was held through even after that representation ended.
 */
function listPastLeadership(db: DatabaseLike, groupId: string): Promise<PublicLeadershipRow[]> {
  return all<PublicLeadershipRow>(
    db,
    `SELECT ur.role_id, ${PUBLIC_PROFILE_SELECT_SQL}, ${LEADERSHIP_TERM_SELECT_SQL}, ${SOURCE_GROUP_SELECT_SQL},
            0 AS depth
       FROM groups source_group
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN user_roles ur
         ON ur.context_type = 'group'
        AND ur.context_id = source_group.id
        AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
        AND (ur.revoked_at IS NOT NULL OR ur.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       JOIN users u ON u.id = ur.user_id
       JOIN members represented_member ON represented_member.id = ur.member_id
       JOIN identities identity ON identity.id = ur.identity_id
       LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
        AND capacity.member_id = represented_member.id
       LEFT JOIN membership_categories category ON category.code = capacity.membership_category
       LEFT JOIN organizations o ON o.id = represented_member.organization_id
      WHERE source_group.id = ?
      ORDER BY ends_at DESC, starts_at DESC, ${PUBLIC_ORDER_SQL}`,
    [groupId],
  );
}

/**
 * Seats: one row per membership capacity. A current leader's seat carries the
 * leadership title; every other seat carries its own title or "Member".
 * Current seats list leaders first; past seats list the most recently ended
 * first. A person representing two Members appears once per seat.
 */
function listRoster(db: DatabaseLike, groupId: string, current: boolean): Promise<PublicTenureRow[]> {
  return all<PublicTenureRow>(
    db,
    `SELECT ${PUBLIC_PROFILE_SELECT_SQL},
            COALESCE(leadership.title, membership.title, ?) AS title,
            membership.joined_at AS starts_at,
            membership.left_at AS ends_at
       FROM group_memberships membership
       JOIN users u ON u.id = membership.user_id
       JOIN members represented_member ON represented_member.id = membership.member_id
       JOIN identities identity ON identity.id = membership.identity_id
       LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
        AND capacity.member_id = represented_member.id
       LEFT JOIN membership_categories category ON category.code = capacity.membership_category
       LEFT JOIN organizations o ON o.id = represented_member.organization_id
       LEFT JOIN (
         SELECT ur.user_id, ur.identity_id, ur.member_id,
                MIN(CASE ur.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END) AS role_rank,
                COALESCE(
                  MIN(CASE ur.role_id WHEN 'role-group_lead' THEN COALESCE(ur.title, gt.lead_title) END),
                  MIN(COALESCE(ur.title, gt.deputy_lead_title))
                ) AS title
           FROM user_roles ur
           JOIN groups g ON g.id = ur.context_id
           JOIN group_types gt ON gt.key = g.type_key
          WHERE ur.context_type = 'group' AND ur.context_id = ?
            AND ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')
            AND ur.revoked_at IS NULL
            AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          GROUP BY ur.user_id, ur.identity_id, ur.member_id, gt.lead_title, gt.deputy_lead_title
       ) leadership
         ON leadership.user_id = membership.user_id
        AND leadership.identity_id = membership.identity_id
        AND leadership.member_id = membership.member_id
        AND membership.left_at IS NULL
      WHERE membership.group_id = ?
        AND membership.left_at IS ${current ? "NULL" : "NOT NULL"}
        ${current ? "AND u.active = 1" : ""}
      ORDER BY ${current ? "COALESCE(leadership.role_rank, 2), membership.joined_at" : "membership.left_at DESC, membership.joined_at DESC"},
               ${PUBLIC_ORDER_SQL}`,
    [DEFAULT_SEAT_TITLE, groupId, groupId],
  );
}

export async function getPublicGroupDirectory(db: DatabaseLike, idOrSlug: string): Promise<GroupDirectoryResponse> {
  const group = await requirePublicGroup(db, idOrSlug);
  const none: never[] = [];
  const [mailingList, leadershipRows, pastLeadershipRows, currentSeats, pastSeats] = await Promise.all([
    first<{ email: string }>(
      db,
      `SELECT email
         FROM mailing_lists
        WHERE group_id = ? AND active = 1 AND is_primary_discussion = 1
        LIMIT 1`,
      [group.id],
    ),
    group.publicLeadership ? listCurrentLeadership(db, group.id) : Promise.resolve(none),
    group.publicLeadership ? listPastLeadership(db, group.id) : Promise.resolve(none),
    group.publicRoster ? listRoster(db, group.id, true) : Promise.resolve(none),
    group.publicRoster ? listRoster(db, group.id, false) : Promise.resolve(none),
  ]);

  return {
    group: {
      id: group.id,
      slug: group.slug,
      name: group.name,
      type: group.type,
    },
    mailingListEmail: mailingList?.email ?? null,
    leadership: leadershipRows.map(toPublicLeadership),
    pastLeadership: pastLeadershipRows.map(toPublicLeadership),
    roster: group.publicRoster
      ? { current: currentSeats.map(toPublicTenure), past: pastSeats.map(toPublicTenure) }
      : null,
  };
}
