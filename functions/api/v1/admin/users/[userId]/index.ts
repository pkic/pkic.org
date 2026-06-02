/**
 * GET  /api/v1/admin/users/:userId  — full user detail
 * PATCH /api/v1/admin/users/:userId — update role / active flag
 *
 * Only a global admin may call these endpoints.
 */
import { parseJsonBody, normalizeEmail } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first, run } from "../../../../../_lib/db/queries";
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
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const userId = c.req.param("userId");

  const user = await first<UserDetailRow>(
    requestDb(c),
    `SELECT id, email, first_name, last_name, preferred_name,
            organization_name, job_title, biography, links_json, role, active,
            headshot_r2_key, headshot_updated_at,
            created_at, updated_at, pii_redacted_at
     FROM users WHERE id = ?`,
    [userId],
  );

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  // Build a public headshot URL from the R2 key (unguessable capability URL)
  let headshotUrl: string | null = null;
  if (user.headshot_r2_key) {
    // R2 key is "headshots/{userId}/{timestamp}.{ext}" → public URL
    headshotUrl = `/api/v1/${user.headshot_r2_key}`;
  }

  return json({
    user: {
      ...user,
      active: Boolean(user.active),
      links: user.links_json ? JSON.parse(user.links_json) : [],
      headshotUrl,
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
    "SELECT id, email, role, active, pii_redacted_at FROM users WHERE id = ?",
    [userId],
  );

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  const newRole = body.role ?? user.role;
  const newActive = body.active ?? Boolean(user.active);

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
    "UPDATE users SET email = ?, normalized_email = ?, role = ?, active = ?, updated_at = ? WHERE id = ?",
    [newEmail, normalizeEmail(newEmail), newRole, newActive ? 1 : 0, nowIso(), user.id],
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
    user: { id: user.id, email: newEmail, role: newRole, active: newActive },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PATCH") return onRequestPatch(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
