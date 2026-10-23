import type { Group } from "../../../../assets/shared/schemas/groups";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";

export interface GroupRow {
  abbreviated_name: string | null;
  id: string;
  slug: string;
  name: string;
  type_key: string;
  type_singular_label: string;
  type_plural_label: string;
  parent_id: string | null;
  parent_slug: string | null;
  parent_name: string | null;
  parent_type_key: string | null;
  parent_type_singular_label: string | null;
  parent_type_plural_label: string | null;
  description: string | null;
  links_json: string | null;
  visibility: Group["visibility"];
  governance_inheritance_mode: "inherited" | "local_only";
  eligibility_mode: "open" | "category" | "managed";
  automatic_enrollment_mode: "none" | "category";
  allow_automatic_opt_out: number;
  public_leadership: number;
  public_roster: number;
  min_endorsers_for_ballot: number;
  active: number;
  revision: number;
  membership_capacity_count: number;
  represented_member_count: number;
  participant_count: number;
  child_count: number;
  created_at: string;
  updated_at: string;
}

export const GROUP_SELECT = `SELECT
  g.id, g.slug, g.name, g.abbreviated_name, g.type_key,
  gt.singular_label AS type_singular_label,
  gt.plural_label AS type_plural_label,
  parent.id AS parent_id, parent.slug AS parent_slug, parent.name AS parent_name,
  parent.type_key AS parent_type_key,
  parent_type.singular_label AS parent_type_singular_label,
  parent_type.plural_label AS parent_type_plural_label,
  g.description, g.links_json, g.visibility, g.governance_inheritance_mode,
  g.eligibility_mode, g.automatic_enrollment_mode,
  g.allow_automatic_opt_out, g.public_leadership, g.public_roster, g.min_endorsers_for_ballot, g.active, g.revision,
  (SELECT COUNT(*) FROM group_memberships capacity
    WHERE capacity.group_id = g.id AND capacity.left_at IS NULL) AS membership_capacity_count,
  (SELECT COUNT(DISTINCT represented.member_id) FROM group_memberships represented
    WHERE represented.group_id = g.id AND represented.left_at IS NULL) AS represented_member_count,
  (SELECT COUNT(DISTINCT participant.user_id) FROM group_memberships participant
    WHERE participant.group_id = g.id AND participant.left_at IS NULL) AS participant_count,
  (SELECT COUNT(*) FROM groups child
    WHERE child.parent_group_id = g.id AND child.active = 1) AS child_count,
  g.created_at, g.updated_at`;

export const GROUP_FROM = `FROM groups g
  JOIN group_types gt ON gt.key = g.type_key
  LEFT JOIN groups parent ON parent.id = g.parent_group_id
  LEFT JOIN group_types parent_type ON parent_type.key = parent.type_key`;

export function mapGroup(row: GroupRow): Group {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    abbreviatedName: row.abbreviated_name,
    type: {
      key: row.type_key,
      singularLabel: row.type_singular_label,
      pluralLabel: row.type_plural_label,
    },
    parentGroup:
      row.parent_id && row.parent_slug && row.parent_name && row.parent_type_key
        ? {
            id: row.parent_id,
            slug: row.parent_slug,
            name: row.parent_name,
            type: {
              key: row.parent_type_key,
              singularLabel: row.parent_type_singular_label ?? row.parent_type_key,
              pluralLabel: row.parent_type_plural_label ?? row.parent_type_key,
            },
          }
        : null,
    description: row.description,
    links: parseLinksJson(row.links_json),
    visibility: row.visibility,
    governanceInheritanceMode: row.governance_inheritance_mode,
    eligibilityMode: row.eligibility_mode,
    automaticEnrollmentMode: row.automatic_enrollment_mode,
    allowAutomaticOptOut: row.allow_automatic_opt_out === 1,
    publicLeadership: row.public_leadership === 1,
    publicRoster: row.public_roster === 1,
    minEndorsersForBallot: row.min_endorsers_for_ballot,
    active: row.active === 1,
    revision: row.revision,
    membershipCapacityCount: row.membership_capacity_count,
    representedMemberCount: row.represented_member_count,
    participantCount: row.participant_count,
    childCount: row.child_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
