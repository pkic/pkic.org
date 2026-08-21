/**
 * Admin headshot management endpoint.
 *
 * GET    /api/v1/admin/users/:userId/headshot        — serve the headshot image
 * PUT    /api/v1/admin/users/:userId/headshot        — upload / replace headshot
 * DELETE /api/v1/admin/users/:userId/headshot        — remove headshot
 *
 * All methods require admin authentication.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first } from "../../../../../_lib/db/queries";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import { AppError } from "../../../../../_lib/errors";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../../../_lib/utils/image-upload";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import {
  adminUserHeadshotDeleteRouteSchema,
  adminUserHeadshotGetRouteSchema,
  adminUserHeadshotPutRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { storedImageResponse } from "../../../../../_lib/services/image-response";
import {
  removePreviousHeadshot,
  removeUserHeadshot,
  replaceUserHeadshot,
} from "../../../../../_lib/services/user-headshot";
interface HeadshotRow {
  id: string;
  headshot_r2_key: string | null;
}

// ── GET — serve the headshot image ──────────────────────────────────────────

async function onGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await first<HeadshotRow>(requestDb(c), "SELECT id, headshot_r2_key FROM users WHERE id = ?", [
    c.req.param("userId"),
  ]);

  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  if (!user.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  return storedImageResponse(bucket, user.headshot_r2_key, {
    notFoundCode: "NOT_FOUND",
    notFoundMessage: "Headshot file missing from storage",
    cacheControl: "private, max-age=3600",
  });
}

// ── PUT — upload / replace headshot ─────────────────────────────────────────

async function onPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await first<HeadshotRow>(requestDb(c), "SELECT id, headshot_r2_key FROM users WHERE id = ?", [
    c.req.param("userId"),
  ]);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const resized = await resizeHeadshot(uploaded.buffer, uploaded.contentType, c.env.IMAGES);
  const r2Key = await replaceUserHeadshot({
    db: requestDb(c),
    bucket,
    userId: user.id,
    previousKey: user.headshot_r2_key,
    image: resized,
    source: "admin_upload",
    audit: {
      actorType: "admin",
      actorId: admin.id,
      action: "headshot_uploaded",
      details: { uploadedBy: "admin" },
    },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(requestDb(c), c.env, user.headshot_r2_key));

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  c.executionCtx.waitUntil(invalidateAndRerender(user.id, c.env, origin));

  return json({ success: true, r2Key });
}

// ── DELETE — remove headshot ────────────────────────────────────────────────

async function onDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await first<HeadshotRow>(requestDb(c), "SELECT id, headshot_r2_key FROM users WHERE id = ?", [
    c.req.param("userId"),
  ]);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  await removeUserHeadshot({
    db: requestDb(c),
    userId: user.id,
    previousKey: user.headshot_r2_key,
    audit: { actorType: "admin", actorId: admin.id, action: "headshot_removed" },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(requestDb(c), c.env, user.headshot_r2_key));

  return json({ success: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function onRequest(c: AdminContext): Promise<Response> {
  switch (c.req.raw.method) {
    case "GET":
      return onGet(c);
    case "PUT":
      return onPut(c);
    case "DELETE":
      return onDelete(c);
    default:
      return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
}

export const AdminUsersUserIdHeadshotGet = openApiRoute(adminUserHeadshotGetRouteSchema, onGet);

// Unused by ./router.ts today — PUT /headshot is wired directly to the
// manual `onRequest` dispatcher below (raw Hono `app.put`, bypassing
// chanfana schema validation, since onGet/onPut/onDelete are also called
// directly with a single `c` argument by that dispatcher and by
// tests/admin-user-headshot.test.ts). Kept in sync with onPut's signature
// so it stays usable if the routing is ever switched over.
export const AdminUsersUserIdHeadshotPut = openApiRoute(adminUserHeadshotPutRouteSchema, onPut);

export const AdminUsersUserIdHeadshotDelete = openApiRoute(adminUserHeadshotDeleteRouteSchema, onDelete);
