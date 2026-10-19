import { GROUP_LEADERSHIP_ROLE_IDS } from "../../../../assets/shared/schemas/groups";

export const GROUP_LEADERSHIP_ROLE_IDS_SQL = GROUP_LEADERSHIP_ROLE_IDS.map((role) => `'${role}'`).join(", ");

/** Shared live-capacity eligibility. The caller supplies effective_lineage(id, depth). */
export function publicGroupLeadershipSourceSql(term: "current" | "expired"): string {
  return `FROM effective_lineage lineage
       JOIN groups source_group ON source_group.id = lineage.id
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN user_roles ur
         ON ur.context_type = 'group'
        AND ur.context_id = lineage.id
        AND ur.role_id IN (${GROUP_LEADERSHIP_ROLE_IDS_SQL})
        AND ur.revoked_at IS NULL
        AND ${
          term === "current"
            ? "(ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
            : "ur.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        }
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
       /*
        * Left, like the roster's and the past terms' — these two joins exist
        * only to supply a job-title fallback for a representative with no
        * organization, and as inner joins they instead deleted that
        * representative from the public leadership list while leaving them on
        * the roster and in past positions. Issue #25 reports it from the
        * outside: someone added to the board whose "photo and data do not
        * render". They rendered nowhere at all.
        */
       LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
        AND capacity.member_id = represented_member.id
       LEFT JOIN membership_categories category ON category.code = capacity.membership_category
       LEFT JOIN organizations o ON o.id = represented_member.organization_id`;
}

export const PUBLIC_CURRENT_GROUP_LEADERSHIP_SOURCE_SQL = publicGroupLeadershipSourceSql("current");
