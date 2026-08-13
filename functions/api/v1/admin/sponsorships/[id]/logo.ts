/**
 * PUT    /api/v1/admin/sponsorships/:id/logo — upload/replace a non-member sponsor's logo
 * DELETE /api/v1/admin/sponsorships/:id/logo — remove it
 *
 * Only applies to non-member sponsors (organization_id IS NULL) — org-tied
 * sponsors already have a logo via the organization itself
 * (PUT /api/v1/admin/organizations/:id/logo), served publicly at
 * GET /api/v1/members/:id/logo. Served here at
 * GET /api/v1/sponsors/:id/logo instead, since a non-member sponsor has no
 * organizations row to key that route off of.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { AppError } from "../../../../../_lib/errors";
import { readUploadedImage, ALLOWED_MIME_TYPES, MAX_HEADSHOT_BYTES } from "../../../../../_lib/utils/headshot-upload";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import type { DatabaseLike } from "../../../../../_lib/types";
import {
  sponsorshipLogoDeleteRouteSchema,
  sponsorshipLogoPutRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";

interface SponsorshipLogoRow {
  id: string;
  organization_id: string | null;
  non_member_logo_r2_key: string | null;
}

async function loadSponsorship(db: DatabaseLike, id: string): Promise<SponsorshipLogoRow> {
  const row = await first<SponsorshipLogoRow>(
    db,
    "SELECT id, organization_id, non_member_logo_r2_key FROM sponsorships WHERE id = ?",
    [id],
  );
  if (!row) throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  if (row.organization_id) {
    throw new AppError(
      422,
      "SPONSORSHIP_IS_ORG_LINKED",
      "This sponsorship is linked to a member organization — upload its logo via the organization instead.",
    );
  }
  return row;
}

async function onPut(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const sponsorship = await loadSponsorship(db, c.req.param("id"));

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
  const r2Key = `sponsor-logos/${sponsorship.id}/${Date.now()}.${ext}`;

  try {
    await bucket.put(r2Key, buffer, { httpMetadata: { contentType } });
  } catch {
    throw new AppError(503, "UPLOAD_FAILED", "Failed to upload logo");
  }

  if (sponsorship.non_member_logo_r2_key) {
    c.executionCtx.waitUntil(
      (bucket as unknown as { delete(key: string): Promise<void> })
        .delete(sponsorship.non_member_logo_r2_key)
        .catch(() => {}),
    );
  }

  const now = nowIso();
  await run(db, "UPDATE sponsorships SET non_member_logo_r2_key = ?, updated_at = ? WHERE id = ?", [
    r2Key,
    now,
    sponsorship.id,
  ]);

  await writeAuditLog(db, "admin", admin.id, "sponsorship_logo_uploaded", "sponsorship", sponsorship.id, { r2Key });

  return json({ success: true, r2Key, logoUrl: `/api/v1/sponsors/${sponsorship.id}/logo` });
}

async function onDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const sponsorship = await loadSponsorship(db, c.req.param("id"));

  if (sponsorship.non_member_logo_r2_key && c.env.ASSETS_BUCKET) {
    c.executionCtx.waitUntil(c.env.ASSETS_BUCKET.delete(sponsorship.non_member_logo_r2_key).catch(() => {}));
  }

  const now = nowIso();
  await run(db, "UPDATE sponsorships SET non_member_logo_r2_key = NULL, updated_at = ? WHERE id = ?", [
    now,
    sponsorship.id,
  ]);

  await writeAuditLog(db, "admin", admin.id, "sponsorship_logo_removed", "sponsorship", sponsorship.id, {
    previousKey: sponsorship.non_member_logo_r2_key,
  });

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "PUT") return onPut(c);
  if (c.req.raw.method === "DELETE") return onDelete(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

export const SponsorshipLogoPut = openApiRoute(sponsorshipLogoPutRouteSchema, (c: AdminContext) => onPut(c));

export const SponsorshipLogoDelete = openApiRoute(sponsorshipLogoDeleteRouteSchema, (c: AdminContext) => onDelete(c));
