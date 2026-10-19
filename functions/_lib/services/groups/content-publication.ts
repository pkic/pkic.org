import type { GroupUpdateInput } from "../../../../assets/shared/schemas/groups";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareSitePublicationRequest } from "../site-publication-requests";

/** Fields that may change public directories, person contributions, or inherited leadership. */
const PUBLIC_FIELDS = {
  name: "name",
  slug: "slug",
  typeKey: "type_key",
  parentGroupId: "parent_group_id",
  governanceInheritanceMode: "governance_inheritance_mode",
  visibility: "visibility",
  active: "active",
  publicLeadership: "public_leadership",
  publicRoster: "public_roster",
} as const;

/**
 * Capture public eligibility before an update; creation runs after its INSERT/audit.
 * Inheritance invalidation is conservative; the renderer compares candidate content before building.
 */
export function prepareGroupContentPublication(
  db: DatabaseLike,
  groupId: string,
  at: string,
  changes?: GroupUpdateInput,
): StatementLike | null {
  const predicates: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(PUBLIC_FIELDS)) {
    const value = changes?.[key as keyof typeof PUBLIC_FIELDS];
    if (value === undefined) continue;
    predicates.push(`g.${column} IS NOT ?`);
    values.push(typeof value === "boolean" ? Number(value) : value);
  }
  if (changes && !predicates.length) return null;
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "group_content",
      resourceId: groupId,
      revision: Date.parse(at),
      reasonCode: "group_content_changed",
      deduplicationKey: `group-content:${groupId}:${crypto.randomUUID()}`,
    },
    {
      sql: `EXISTS (SELECT 1 FROM groups g WHERE g.id=?
      AND (${predicates.length ? predicates.join(" OR ") : "1"})
      AND ((g.active=1 AND (g.visibility='public' OR g.public_roster=1 OR g.public_leadership=1))
        OR (COALESCE(?,g.active)=1 AND (COALESCE(?,g.visibility)='public'
          OR COALESCE(?,g.public_roster)=1 OR COALESCE(?,g.public_leadership)=1))
        OR (?=1 AND g.name IS NOT ? AND EXISTS (SELECT 1 FROM votes vote WHERE vote.owner_group_id=g.id AND vote.visibility='public'))
        OR EXISTS (WITH RECURSIVE descendants(id) AS (
          SELECT g.id UNION ALL SELECT child.id FROM groups child JOIN descendants parent ON child.parent_group_id=parent.id
            WHERE child.governance_inheritance_mode='inherited')
          SELECT 1 FROM descendants JOIN groups published ON published.id=descendants.id
            WHERE published.id<>g.id AND published.active=1 AND published.public_leadership=1
              AND (?=1 OR g.visibility='public' OR COALESCE(?,g.visibility)='public')
              AND (?=1 OR EXISTS (SELECT 1 FROM user_roles role WHERE role.context_type='group' AND role.context_id=g.id
                AND role.role_id IN ('role-group_lead','role-group_deputy_lead'))))))`,
      bindings: [
        groupId,
        ...values,
        changes?.active === undefined ? null : Number(changes.active),
        changes?.visibility ?? null,
        changes?.publicRoster === undefined ? null : Number(changes.publicRoster),
        changes?.publicLeadership === undefined ? null : Number(changes.publicLeadership),
        changes?.name === undefined ? 0 : 1,
        changes?.name ?? null,
        changes?.parentGroupId !== undefined || changes?.governanceInheritanceMode !== undefined ? 1 : 0,
        changes?.visibility ?? null,
        changes?.parentGroupId !== undefined || changes?.governanceInheritanceMode !== undefined ? 1 : 0,
      ],
    },
  );
}
