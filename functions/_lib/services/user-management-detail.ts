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
  is_default: number;
  organization_id: string | null;
  organization_name: string | null;
  email_id: string | null;
  capacity_email: string;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  created_at: string;
}

interface FormerIdentityRow {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  job_title: string | null;
  started_at: string | null;
  ended_at: string;
}

interface MembershipGroupRow {
  identity_id: string;
  id: string;
  name: string;
  slug: string;
  type_key: string;
  type_singular_label: string;
  type_plural_label: string;
}

/** Fetches the complete user projection in one D1 batch. */
export async function getUserDetail(db: DatabaseLike, userId: string) {
  const [userResult, membershipResult, formerResult, groupsResult] = await db.batch([
    db
      .prepare(
        `SELECT id, email, first_name, last_name, preferred_name,
                role, active, is_ec_member,
                headshot_r2_key, headshot_updated_at, created_at, updated_at, pii_redacted_at
         FROM users WHERE id = ?`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT identity.id, m.id AS capacity_member_id, mca.category_code, m.status,
                identity.show_on_organization_profile AS show_on_org_profile,
                identity.is_default,
                m.organization_id, o.name AS organization_name,
                identity.email_id, COALESCE(selected_email.email, u.email) AS capacity_email,
                CASE WHEN identity.organization_id IS NULL THEN category.label ELSE identity.job_title END AS job_title,
                identity.biography, identity.links_json, identity.created_at,
                CASE WHEN m.organization_id IS NULL THEN '0_' ELSE '1_' END || identity.started_at AS sort_key
         FROM identities identity
         JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
         JOIN members m ON m.id = capacity.member_id
         LEFT JOIN organizations o ON o.id = m.organization_id
         JOIN users u ON u.id = identity.user_id
         LEFT JOIN user_emails selected_email
           ON selected_email.id = identity.email_id
          AND selected_email.user_id = identity.user_id
          AND selected_email.verified_at IS NOT NULL
         JOIN member_category_assignments mca ON mca.member_id = m.id
         JOIN membership_categories category ON category.code = mca.category_code
         WHERE identity.user_id = ?
           AND identity.started_at IS NOT NULL
           AND identity.ended_at IS NULL
           AND identity.blocked_at IS NULL
         ORDER BY sort_key ASC`,
      )
      .bind(userId),
    db
      .prepare(
        /*
         * Affiliations that have ended. The active-identity query above filters
         * these out on purpose — an ended identity confers nothing — so a
         * record that wants to show a history has to ask for them separately.
         * Most recently ended first: a history reads backwards from now.
         */
        `SELECT identity.id, identity.organization_id, o.name AS organization_name,
                identity.job_title, identity.started_at, identity.ended_at
           FROM identities identity
           LEFT JOIN organizations o ON o.id = identity.organization_id
          WHERE identity.user_id = ?
            AND identity.ended_at IS NOT NULL
          ORDER BY identity.ended_at DESC, identity.id`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT membership.identity_id, g.id, g.name, g.slug, g.type_key,
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
  const groupsByIdentityId = new Map<string, MembershipGroupRow[]>();
  for (const group of batchRows<MembershipGroupRow>(groupsResult)) {
    const groups = groupsByIdentityId.get(group.identity_id) ?? [];
    groups.push(group);
    groupsByIdentityId.set(group.identity_id, groups);
  }
  const identities = batchRows<MembershipRow>(membershipResult).map((identity) => ({
    identityId: identity.id,
    memberId: identity.capacity_member_id,
    membershipCategory: identity.category_code,
    status: identity.status,
    showOnOrgProfile: identity.show_on_org_profile === 1,
    isDefault: identity.is_default === 1,
    organizationId: identity.organization_id,
    organizationName: identity.organization_name,
    emailId: identity.email_id,
    email: identity.capacity_email,
    jobTitle: identity.job_title,
    biography: identity.biography,
    links: parseLinksJson(identity.links_json),
    createdAt: identity.created_at,
    groups: (groupsByIdentityId.get(identity.id) ?? []).map((group) => ({
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
  const formerIdentities = batchRows<FormerIdentityRow>(formerResult).map((identity) => ({
    identityId: identity.id,
    organizationId: identity.organization_id,
    organizationName: identity.organization_name,
    jobTitle: identity.job_title,
    startedAt: identity.started_at,
    endedAt: identity.ended_at,
  }));

  return {
    ...publicUser,
    active: Boolean(user.active),
    isEcMember: Boolean(user.is_ec_member),
    headshotUrl,
    identities,
    formerIdentities,
  };
}
