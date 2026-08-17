/**
 * GET  /api/v1/admin/users/:userId  — full user detail
 * PATCH /api/v1/admin/users/:userId — update role / active flag
 *
 * Only a global admin may call these endpoints.
 */
import { parseJsonBody, normalizeEmail } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { all, first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { AppError } from "../../../../../_lib/errors";
import { adminUserUpdateSchema } from "../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

interface UserRow {
  id: string;
  email: string;
  role: string;
  active: number;
  is_ec_member: number;
  pii_redacted_at: string | null;
}

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

// ── GET ─────────────────────────────────────────────────────────────────────

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

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const userId = c.req.param("userId");

  const user = await first<UserDetailRow>(
    requestDb(c),
    `SELECT id, email, first_name, last_name, preferred_name,
            organization_name, job_title, biography, links_json, role, active, is_ec_member,
            headshot_r2_key, headshot_updated_at,
            created_at, updated_at, pii_redacted_at
     FROM users WHERE id = ?`,
    [userId],
  );

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  // Served via the admin-auth-gated endpoint rather than reconstructing a
  // public capability URL from the raw R2 key — that assumes the
  // "headshots/{userId}/{file}" key scheme, which doesn't hold for users
  // created by the YAML migration script ("member-photos/{slug}/{file}").
  // The endpoint URL is stable per user, so `headshot_updated_at` is appended
  // as a cache-busting query param — otherwise the browser's HTTP cache
  // (max-age=3600 on that endpoint) would keep serving the old image for up
  // to an hour after a re-upload.
  let headshotUrl: string | null = null;
  if (user.headshot_r2_key) {
    headshotUrl = `/api/v1/admin/users/${user.id}/headshot`;
    if (user.headshot_updated_at) {
      headshotUrl += `?v=${encodeURIComponent(user.headshot_updated_at)}`;
    }
  }

  // Individual membership (members.user_id set) or organization
  // representative (members.user_id is NULL for org-tied aggregates —
  // migration 0000's CHECK — so a representative resolves only via their
  // own organization_representatives row).
  // A user can hold an individual membership and/or represent more than one
  // organization concurrently (migration 0037) — this summary shows
  // exactly one, so order deterministically (individual row first, then
  // organizations by earliest joined_at) rather than an arbitrary LIMIT 1
  // over an unordered UNION.
  const memberRow = await first<MembershipRow>(
    requestDb(c),
    `SELECT m.id, mca.category_code, m.status, 1 AS show_on_org_profile, NULL AS organization_id, NULL AS organization_name, m.created_at,
            '0_' || m.created_at AS sort_key
     FROM members m
     JOIN member_category_assignments mca ON mca.member_id = m.id
     WHERE m.user_id = ?

     UNION ALL

     SELECT r.id, mca.category_code, m.status, r.show_on_org_profile, m.organization_id, o.name AS organization_name, r.created_at,
            '1_' || r.joined_at AS sort_key
     FROM organization_representatives r
     JOIN members m ON m.id = r.member_id
     JOIN organizations o ON o.id = m.organization_id
     JOIN member_category_assignments mca ON mca.member_id = m.id
     WHERE r.user_id = ? AND r.left_at IS NULL
     ORDER BY sort_key ASC
     LIMIT 1`,
    [userId, userId],
  );

  let membership = null;
  if (memberRow) {
    const workingGroups = await all<WorkingGroupRow>(
      requestDb(c),
      `SELECT wg.id, wg.name, wg.slug
       FROM working_group_members wgm
       JOIN working_groups wg ON wg.id = wgm.working_group_id
       WHERE wgm.user_id = ? AND wgm.left_at IS NULL
       ORDER BY wg.name ASC`,
      [userId],
    );
    membership = {
      memberId: memberRow.id,
      membershipCategory: memberRow.category_code,
      status: memberRow.status,
      showOnOrgProfile: memberRow.show_on_org_profile === 1,
      organizationId: memberRow.organization_id,
      organizationName: memberRow.organization_name,
      createdAt: memberRow.created_at,
      workingGroups,
    };
  }

  return json({
    user: {
      ...user,
      active: Boolean(user.active),
      isEcMember: Boolean(user.is_ec_member),
      links: user.links_json ? JSON.parse(user.links_json) : [],
      headshotUrl,
      membership,
    },
  });
}

// ── PATCH ───────────────────────────────────────────────────────────────────

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminUserUpdateSchema);
  const userId = c.req.param("userId");

  // Prevent self-demotion / self-deactivation
  if (userId === admin.id) {
    if (body.role !== undefined && body.role !== "admin") {
      throw new AppError(403, "FORBIDDEN", "You cannot demote your own account");
    }
    if (body.active === false) {
      throw new AppError(403, "FORBIDDEN", "You cannot deactivate your own account");
    }
  }

  const user = await first<UserRow>(
    requestDb(c),
    "SELECT id, email, role, active, is_ec_member, pii_redacted_at FROM users WHERE id = ?",
    [userId],
  );

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  const newRole = body.role ?? user.role;
  const newActive = body.active ?? Boolean(user.active);
  const newIsEcMember = body.isEcMember ?? Boolean(user.is_ec_member);

  // Email change — check uniqueness before any mutations
  let newEmail = user.email;
  if (body.email !== undefined) {
    const normalized = normalizeEmail(body.email);
    if (normalized !== normalizeEmail(user.email)) {
      const existing = await first<{ id: string }>(
        requestDb(c),
        "SELECT id FROM users WHERE normalized_email = ? AND id != ?",
        [normalized, user.id],
      );
      if (existing) {
        throw new AppError(409, "EMAIL_ALREADY_IN_USE", "Another account already uses that email address");
      }
      newEmail = normalized;
    }
  }

  const ALLOWED_PII_COLUMNS = new Set([
    "first_name",
    "last_name",
    "preferred_name",
    "organization_name",
    "job_title",
    "biography",
    "links_json",
  ]);

  const piiUpdates: Record<string, string | null> = {};
  if (body.firstName !== undefined) piiUpdates.first_name = body.firstName || null;
  if (body.lastName !== undefined) piiUpdates.last_name = body.lastName || null;
  if (body.preferredName !== undefined) piiUpdates.preferred_name = body.preferredName || null;
  if (body.organizationName !== undefined) piiUpdates.organization_name = body.organizationName || null;
  if (body.jobTitle !== undefined) piiUpdates.job_title = body.jobTitle || null;
  if (body.biography !== undefined) piiUpdates.biography = body.biography || null;
  if (body.links !== undefined)
    piiUpdates.links_json = body.links && body.links.length > 0 ? JSON.stringify(body.links) : null;

  const safeKeys = Object.keys(piiUpdates).filter((col) => ALLOWED_PII_COLUMNS.has(col));
  const hasPiiUpdates = safeKeys.length > 0;

  // Fetch current PII values before mutating so we can produce accurate audit log diffs.
  let currentDetail: UserDetailRow | null = null;
  if (hasPiiUpdates) {
    currentDetail = await first<UserDetailRow>(
      requestDb(c),
      `SELECT id, email, first_name, last_name, preferred_name, organization_name, job_title, biography, links_json,
              role, active, headshot_r2_key, headshot_updated_at, created_at, updated_at, pii_redacted_at
       FROM users WHERE id = ?`,
      [user.id],
    );
  }

  if (hasPiiUpdates) {
    const setClauses = safeKeys.map((col) => `${col} = ?`).join(", ");
    const values = [...safeKeys.map((col) => piiUpdates[col]), nowIso(), user.id];
    await run(requestDb(c), `UPDATE users SET ${setClauses}, updated_at = ? WHERE id = ?`, values);
  }

  await run(
    requestDb(c),
    "UPDATE users SET email = ?, normalized_email = ?, role = ?, active = ?, is_ec_member = ?, updated_at = ? WHERE id = ?",
    [newEmail, normalizeEmail(newEmail), newRole, newActive ? 1 : 0, newIsEcMember ? 1 : 0, nowIso(), user.id],
  );

  const changes: Record<string, unknown> = {};
  if (newEmail !== user.email) {
    changes.email = { from: user.email, to: newEmail };
  }
  if (body.role !== undefined && body.role !== user.role) {
    changes.role = { from: user.role, to: newRole };
  }
  if (body.active !== undefined && body.active !== Boolean(user.active)) {
    changes.active = { from: Boolean(user.active), to: newActive };
  }
  if (body.isEcMember !== undefined && body.isEcMember !== Boolean(user.is_ec_member)) {
    changes.isEcMember = { from: Boolean(user.is_ec_member), to: newIsEcMember };
  }
  if (hasPiiUpdates && currentDetail) {
    for (const col of safeKeys) {
      const before = currentDetail[col as keyof UserDetailRow];
      const after = piiUpdates[col];
      if (before !== after) {
        changes[col] = { from: before, to: after };
      }
    }
  }

  if (Object.keys(changes).length > 0) {
    await writeAuditLog(requestDb(c), "admin", admin.id, "user_updated", "user", user.id, changes);
  }

  return json({
    success: true,
    user: { id: user.id, email: newEmail, role: newRole, active: newActive, isEcMember: newIsEcMember },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PATCH") return onRequestPatch(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
