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
  category_code: string;
  status: string;
  show_on_org_profile: number;
  organization_id: string | null;
  organization_name: string | null;
  created_at: string;
}

interface WorkingGroupRow {
  id: string;
  name: string;
  slug: string;
}

/** Fetches the complete admin user projection in one D1 batch. */
export async function getAdminUserDetail(db: DatabaseLike, userId: string) {
  const [userResult, membershipResult, workingGroupsResult] = await db.batch([
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
        `SELECT m.id, mca.category_code, m.status, 1 AS show_on_org_profile,
                NULL AS organization_id, NULL AS organization_name, m.created_at,
                '0_' || m.created_at AS sort_key
         FROM members m
         JOIN member_category_assignments mca ON mca.member_id = m.id
         WHERE m.user_id = ?

         UNION ALL

         SELECT r.id, mca.category_code, m.status, r.show_on_org_profile,
                m.organization_id, o.name AS organization_name, r.created_at,
                '1_' || r.joined_at AS sort_key
         FROM organization_representatives r
         JOIN members m ON m.id = r.member_id
         JOIN organizations o ON o.id = m.organization_id
         JOIN member_category_assignments mca ON mca.member_id = m.id
         WHERE r.user_id = ? AND r.left_at IS NULL
         ORDER BY sort_key ASC
         LIMIT 1`,
      )
      .bind(userId, userId),
    db
      .prepare(
        `SELECT wg.id, wg.name, wg.slug
         FROM working_group_members wgm
         JOIN working_groups wg ON wg.id = wgm.working_group_id
         WHERE wgm.user_id = ? AND wgm.left_at IS NULL
         ORDER BY wg.name ASC`,
      )
      .bind(userId),
  ]);
  const user = batchFirst<UserDetailRow>(userResult);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  const membershipRow = batchFirst<MembershipRow>(membershipResult);
  const membership = membershipRow
    ? {
        memberId: membershipRow.id,
        membershipCategory: membershipRow.category_code,
        status: membershipRow.status,
        showOnOrgProfile: membershipRow.show_on_org_profile === 1,
        organizationId: membershipRow.organization_id,
        organizationName: membershipRow.organization_name,
        createdAt: membershipRow.created_at,
        workingGroups: batchRows<WorkingGroupRow>(workingGroupsResult),
      }
    : null;
  const headshotUrl = user.headshot_r2_key
    ? `/api/v1/admin/users/${user.id}/headshot${
        user.headshot_updated_at ? `?v=${encodeURIComponent(user.headshot_updated_at)}` : ""
      }`
    : null;
  return {
    ...user,
    active: Boolean(user.active),
    isEcMember: Boolean(user.is_ec_member),
    links: parseLinksJson(user.links_json),
    headshotUrl,
    membership,
  };
}
