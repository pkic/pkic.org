import type { GroupDirectoryResponse } from "../../../../assets/shared/schemas/group-directory";
import type { GroupLeadershipRoleId } from "../group-leadership-query";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { toPublicRoleProfile, type PublicRoleProfileRow } from "../membership/public-role-profile";
import { EFFECTIVE_GROUP_LINEAGE_CTE } from "./governance";
import { getVisibleGroup } from "./read-model";

interface PublicLeadershipRow extends PublicRoleProfileRow {
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

async function requirePublicGroup(db: DatabaseLike, idOrSlug: string) {
  const group = await getVisibleGroup(db, idOrSlug, {});
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not publicly visible");
  return group;
}

export async function getPublicGroupDirectory(db: DatabaseLike, idOrSlug: string): Promise<GroupDirectoryResponse> {
  const group = await requirePublicGroup(db, idOrSlug);
  const [mailingList, leadershipRows] = await Promise.all([
    first<{ email: string }>(
      db,
      `SELECT email
         FROM mailing_lists
        WHERE group_id = ? AND active = 1 AND is_primary_discussion = 1
        LIMIT 1`,
      [group.id],
    ),
    group.publicLeadership
      ? all<PublicLeadershipRow>(
          db,
          `${EFFECTIVE_GROUP_LINEAGE_CTE}
           SELECT ur.role_id, u.first_name, u.last_name,
                  CASE WHEN identity.organization_id IS NULL THEN category.label ELSE identity.job_title END AS job_title,
                  o.id AS org_id, o.name AS org_name,
                  o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
                  identity.id AS identity_id,
                  u.headshot_r2_key,
                  identity.links_json,
                  source_group.id AS source_group_id,
                  source_group.slug AS source_group_slug,
                  source_group.name AS source_group_name,
                  source_group.type_key AS source_group_type_key,
                  source_type.singular_label AS source_group_type_singular_label,
                  source_type.plural_label AS source_group_type_plural_label,
                  source_group.visibility AS source_group_visibility,
                  lineage.depth
             FROM effective_lineage lineage
             JOIN groups source_group ON source_group.id = lineage.id
             JOIN group_types source_type ON source_type.key = source_group.type_key
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
            WHERE identity.id IS NOT NULL
            ORDER BY lineage.depth,
                     CASE ur.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END,
                     LOWER(COALESCE(u.last_name, '')),
                     LOWER(COALESCE(u.first_name, '')),
                     u.id`,
          [group.id],
        )
      : Promise.resolve([]),
  ]);

  return {
    group: {
      id: group.id,
      slug: group.slug,
      name: group.name,
      type: group.type,
    },
    mailingListEmail: mailingList?.email ?? null,
    leadership: leadershipRows.map((row) => ({
      roleId: row.role_id,
      person: toPublicRoleProfile(row),
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
    })),
  };
}
