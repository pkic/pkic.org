import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { batchFirst, batchRows } from "../db/pagination";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

interface UserDetailRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  role: string;
  active: number;
  is_ec_member: number;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
}

interface MembershipRow {
  id: string;
  capacity_member_id: string;
  category_code: string;
  status: string;
  show_on_org_profile: number;
  organization_id: string | null;
  organization_name: string | null;
  email_id: string | null;
  capacity_email: string;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  created_at: string;
}

interface MembershipGroupRow {
  member_id: string;
  id: string;
  name: string;
  slug: string;
  type_key: string;
  type_singular_label: string;
  type_plural_label: string;
}

/** Fetches the complete user projection in one D1 batch. */
export async function getUserDetail(db: DatabaseLike, userId: string) {
  const [userResult, membershipResult, groupsResult] = await db.batch([
    db
      .prepare(
        `SELECT id, email, first_name, last_name, preferred_name,
                organization_name, job_title, biography, links_json, role, active, is_ec_member,
                headshot_r2_key, headshot_updated_at, created_at, updated_at, pii_redacted_at
         FROM users WHERE id = ?`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT m.id, m.id AS capacity_member_id, mca.category_code, m.status, 1 AS show_on_org_profile,
                NULL AS organization_id, NULL AS organization_name,
                NULL AS email_id, u.email AS capacity_email,
                u.job_title, u.biography, u.links_json, m.created_at,
                '0_' || m.created_at AS sort_key
         FROM members m
         JOIN users u ON u.id = m.user_id
         JOIN member_category_assignments mca ON mca.member_id = m.id
         WHERE m.user_id = ?

         UNION ALL

         SELECT r.id, m.id AS capacity_member_id, mca.category_code, m.status, r.show_on_org_profile,
                m.organization_id, o.name AS organization_name,
                r.email_id, COALESCE(selected_email.email, u.email) AS capacity_email,
                r.job_title, r.biography, r.links_json, r.created_at,
                '1_' || r.joined_at AS sort_key
         FROM organization_representatives r
         JOIN members m ON m.id = r.member_id
         JOIN organizations o ON o.id = m.organization_id
         JOIN users u ON u.id = r.user_id
         LEFT JOIN user_emails selected_email
           ON selected_email.id = r.email_id
          AND selected_email.user_id = r.user_id
          AND selected_email.verified_at IS NOT NULL
         JOIN member_category_assignments mca ON mca.member_id = m.id
         WHERE r.user_id = ? AND r.left_at IS NULL
         ORDER BY sort_key ASC`,
      )
      .bind(userId, userId),
    db
      .prepare(
        `SELECT membership.member_id, g.id, g.name, g.slug, g.type_key,
                type.singular_label AS type_singular_label,
                type.plural_label AS type_plural_label
           FROM group_memberships membership
           JOIN groups g ON g.id = membership.group_id
           JOIN group_types type ON type.key = g.type_key
          WHERE membership.user_id = ? AND membership.left_at IS NULL
          ORDER BY g.name COLLATE NOCASE, g.id`,
      )
      .bind(userId),
  ]);
  const user = batchFirst<UserDetailRow>(userResult);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  const groupsByMemberId = new Map<string, MembershipGroupRow[]>();
  for (const group of batchRows<MembershipGroupRow>(groupsResult)) {
    const groups = groupsByMemberId.get(group.member_id) ?? [];
    groups.push(group);
    groupsByMemberId.set(group.member_id, groups);
  }
  const memberships = batchRows<MembershipRow>(membershipResult).map((membership) => ({
    memberId: membership.id,
    membershipCategory: membership.category_code,
    status: membership.status,
    showOnOrgProfile: membership.show_on_org_profile === 1,
    organizationId: membership.organization_id,
    organizationName: membership.organization_name,
    emailId: membership.email_id,
    email: membership.capacity_email,
    jobTitle: membership.job_title,
    biography: membership.biography,
    links: parseLinksJson(membership.links_json),
    createdAt: membership.created_at,
    groups: (groupsByMemberId.get(membership.capacity_member_id) ?? []).map((group) => ({
      id: group.id,
      slug: group.slug,
      name: group.name,
      type: {
        key: group.type_key,
        singularLabel: group.type_singular_label,
        pluralLabel: group.type_plural_label,
      },
    })),
  }));
  const headshotUrl = user.headshot_r2_key
    ? `/api/v1/users/${user.id}/headshot${
        user.headshot_updated_at ? `?v=${encodeURIComponent(user.headshot_updated_at)}` : ""
      }`
    : null;
  const { headshot_r2_key: _headshotR2Key, headshot_updated_at: _headshotUpdatedAt, ...publicUser } = user;
  return {
    ...publicUser,
    active: Boolean(user.active),
    isEcMember: Boolean(user.is_ec_member),
    links: parseLinksJson(user.links_json),
    headshotUrl,
    memberships,
  };
}
