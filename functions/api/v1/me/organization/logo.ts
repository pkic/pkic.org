/**
 * POST /api/v1/me/organization/logo — propose a new organization logo.
 * Held in R2 under a staging key until a staff admin approves
 * the content review it's attached to — mirrors admin/organizations/[id]/
 * logo.ts's upload pipeline but writes to a staging key instead of the live
 * one, and folds into the org's moderation queue instead of applying
 * immediately.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { AppError } from "../../../../_lib/errors";
import { ALLOWED_MIME_TYPES, MAX_HEADSHOT_BYTES, readUploadedImage } from "../../../../_lib/utils/headshot-upload";
import { requireOrgContact, stageOrganizationLogo } from "../../../../_lib/services/organization-content-reviews";
import { myOrganizationLogoUploadRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeOrganizationLogoPost = openApiRoute(myOrganizationLogoUploadRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  // Validate eligibility before touching R2 — avoids uploading an orphaned
  // object for a caller who turns out not to be an org contact.
  await requireOrgContact(db, member);

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
  const r2Key = `org-logos/${member.organizationId}/staging-${Date.now()}.${ext}`;
  await bucket.put(r2Key, buffer, { httpMetadata: { contentType } });

  const { previousStagingKey } = await stageOrganizationLogo(db, member, r2Key);

  if (previousStagingKey && previousStagingKey !== r2Key) {
    c.executionCtx.waitUntil(
      (bucket as unknown as { delete(key: string): Promise<void> }).delete(previousStagingKey).catch(() => {}),
    );
  }

  return json({ success: true, r2Key });
});
