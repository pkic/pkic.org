/**
 * PUT    /api/v1/admin/organizations/:id/logo — upload/replace an org logo
 * DELETE /api/v1/admin/organizations/:id/logo — remove the org logo
 *
 * Stored raw (no forced JPEG re-encode, unlike user headshots) since logos
 * are frequently transparent PNGs/SVGs at non-square aspect ratios. Served
 * publicly via the existing `GET /api/v1/members/:id/logo` (§1.6 decision 4)
 * — `id` there is the organization id for org-tied members, so no separate
 * admin GET is needed.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { AppError } from "../../../../../_lib/errors";
import { readUploadedImage, ALLOWED_MIME_TYPES, MAX_HEADSHOT_BYTES } from "../../../../../_lib/utils/headshot-upload";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import {
  adminOrganizationLogoDeleteRouteSchema,
  adminOrganizationLogoPutRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";

interface OrgLogoRow {
  id: string;
  logo_r2_key: string | null;
}

async function onPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:write");

  const id = c.req.param("id");
  const org = await first<OrgLogoRow>(requestDb(c), "SELECT id, logo_r2_key FROM organizations WHERE id = ?", [id]);
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const { buffer, contentType } = await readUploadedImage(c.req.raw);
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    return json(
      { error: { code: "INVALID_FILE_TYPE", message: "Only JPEG, PNG, and WebP images are accepted." } },
      415,
    );
  }
  if (buffer.byteLength > MAX_HEADSHOT_BYTES) {
    return json(
      { error: { code: "FILE_TOO_LARGE", message: `Logo must be under ${MAX_HEADSHOT_BYTES / (1024 * 1024)} MB.` } },
      413,
    );
  }

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const r2Key = `org-logos/${org.id}/${Date.now()}.${ext}`;

  try {
    await bucket.put(r2Key, buffer, { httpMetadata: { contentType } });
  } catch {
    throw new AppError(503, "UPLOAD_FAILED", "Failed to upload logo");
  }

  if (org.logo_r2_key) {
    c.executionCtx.waitUntil(
      (bucket as unknown as { delete(key: string): Promise<void> }).delete(org.logo_r2_key).catch(() => {}),
    );
  }

  const now = nowIso();
  await run(requestDb(c), "UPDATE organizations SET logo_r2_key = ?, updated_at = ? WHERE id = ?", [
    r2Key,
    now,
    org.id,
  ]);

  await writeAuditLog(requestDb(c), "admin", admin.id, "organization_logo_uploaded", "organization", org.id, { r2Key });

  return json({ success: true, r2Key, logoUrl: `/api/v1/members/${org.id}/logo` });
}

async function onDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:write");

  const id = c.req.param("id");
  const org = await first<OrgLogoRow>(requestDb(c), "SELECT id, logo_r2_key FROM organizations WHERE id = ?", [id]);
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  if (org.logo_r2_key && c.env.ASSETS_BUCKET) {
    c.executionCtx.waitUntil(c.env.ASSETS_BUCKET.put(org.logo_r2_key, "").catch(() => {}));
  }

  const now = nowIso();
  await run(requestDb(c), "UPDATE organizations SET logo_r2_key = NULL, updated_at = ? WHERE id = ?", [now, org.id]);

  await writeAuditLog(requestDb(c), "admin", admin.id, "organization_logo_removed", "organization", org.id, {
    previousKey: org.logo_r2_key,
  });

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "PUT") return onPut(c);
  if (c.req.raw.method === "DELETE") return onDelete(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

export class OrganizationLogoPut extends OpenAPIRoute {
  schema = adminOrganizationLogoPutRouteSchema;
  async handle(c: AdminContext) {
    return onPut(c);
  }
}

export class OrganizationLogoDelete extends OpenAPIRoute {
  schema = adminOrganizationLogoDeleteRouteSchema;
  async handle(c: AdminContext) {
    return onDelete(c);
  }
}
