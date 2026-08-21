/**
 * Admin headshot management endpoint.
 *
 * GET    /api/v1/admin/users/:userId/headshot        — serve the headshot image
 * PUT    /api/v1/admin/users/:userId/headshot        — upload / replace headshot
 * DELETE /api/v1/admin/users/:userId/headshot        — remove headshot
 *
 * All methods require admin authentication.
 */
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../../../_lib/utils/image-upload";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import {
  adminUserHeadshotDeleteRouteSchema,
  adminUserHeadshotGetRouteSchema,
  adminUserHeadshotPutRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  adminUserHeadshotResponse,
  getUserHeadshotRecord,
  removeUserHeadshotForRequest,
  requireUserHeadshotBucket,
  uploadUserHeadshotForRequest,
} from "../../../../../_lib/services/user-headshot";

// ── GET — serve the headshot image ──────────────────────────────────────────

async function onGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  return adminUserHeadshotResponse(requestDb(c), requireUserHeadshotBucket(c.env), c.req.param("userId"));
}

// ── PUT — upload / replace headshot ─────────────────────────────────────────

async function onPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await getUserHeadshotRecord(requestDb(c), c.req.param("userId"));

  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const resized = await resizeHeadshot(uploaded.buffer, uploaded.contentType, c.env.IMAGES);
  const { r2Key } = await uploadUserHeadshotForRequest(
    requestDb(c),
    c.env,
    c.req.raw,
    c.executionCtx.waitUntil.bind(c.executionCtx),
    {
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
    },
  );

  return json({ success: true, r2Key });
}

// ── DELETE — remove headshot ────────────────────────────────────────────────

async function onDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await getUserHeadshotRecord(requestDb(c), c.req.param("userId"));

  await removeUserHeadshotForRequest(requestDb(c), c.env, c.req.raw, c.executionCtx.waitUntil.bind(c.executionCtx), {
    userId: user.id,
    previousKey: user.headshot_r2_key,
    audit: { actorType: "admin", actorId: admin.id, action: "headshot_removed" },
  });

  return json({ success: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onGet, PUT: onPut, DELETE: onDelete });
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
