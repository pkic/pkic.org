/**
 * Staff user-headshot management endpoint.
 *
 * GET    /api/v1/users/:userId/headshot        — serve the headshot image
 * PUT    /api/v1/users/:userId/headshot        — upload / replace headshot
 * DELETE /api/v1/users/:userId/headshot        — remove headshot
 *
 * All methods require an attributable staff session.
 */
import { json } from "../../../../_lib/http";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../../_lib/utils/image-upload";
import type { AdminContext } from "../../../../_lib/db/context";
import {
  userHeadshotDeleteRouteSchema,
  userHeadshotGetRouteSchema,
  userHeadshotPutRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-headshots";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import {
  userHeadshotResponse,
  getUserHeadshotRecord,
  removeUserHeadshotForRequest,
  requireUserHeadshotBucket,
  uploadUserHeadshotForRequest,
  userHeadshotTargetGuard,
} from "../../../../_lib/services/user-headshot";
import { authorizedUserMutationDb } from "../../../../_lib/services/user-management-authorization";
import { requireUserStaffPermission } from "../authorization";

// ── GET — serve the headshot image ──────────────────────────────────────────

async function onGet(c: AdminContext, data: ValidatedData<typeof userHeadshotGetRouteSchema>): Promise<Response> {
  const { db } = await requireUserStaffPermission(c, "users:read");

  return userHeadshotResponse(db, requireUserHeadshotBucket(c.env), data.params.userId);
}

// ── PUT — upload / replace headshot ─────────────────────────────────────────

async function onPut(c: AdminContext, data: ValidatedData<typeof userHeadshotPutRouteSchema>): Promise<Response> {
  const { db, staff } = await requireUserStaffPermission(c, "users:write");
  const authorizedDb = authorizedUserMutationDb(db, staff, ["users:write"]);

  const user = await getUserHeadshotRecord(db, data.params.userId);

  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const resized = await resizeHeadshot(uploaded.buffer, c.env.IMAGES);
  await uploadUserHeadshotForRequest(authorizedDb, c.env, c.req.raw, c.executionCtx.waitUntil.bind(c.executionCtx), {
    userId: user.id,
    previousKey: user.headshot_r2_key,
    commitGuard: userHeadshotTargetGuard(user),
    image: resized,
    source: "staff_upload",
    audit: {
      actorType: "admin",
      actorId: staff.id,
      action: "headshot_uploaded",
      details: { uploadedBy: "staff" },
    },
  });

  return json({ success: true });
}

// ── DELETE — remove headshot ────────────────────────────────────────────────

async function onDelete(c: AdminContext, data: ValidatedData<typeof userHeadshotDeleteRouteSchema>): Promise<Response> {
  const { db, staff } = await requireUserStaffPermission(c, "users:write");
  const authorizedDb = authorizedUserMutationDb(db, staff, ["users:write"]);

  const user = await getUserHeadshotRecord(db, data.params.userId);

  await removeUserHeadshotForRequest(authorizedDb, c.env, c.req.raw, c.executionCtx.waitUntil.bind(c.executionCtx), {
    userId: user.id,
    previousKey: user.headshot_r2_key,
    commitGuard: userHeadshotTargetGuard(user),
    audit: { actorType: "admin", actorId: staff.id, action: "headshot_removed" },
  });

  return json({ success: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

export const UserHeadshotGet = openApiRoute(userHeadshotGetRouteSchema, onGet);
export const UserHeadshotPut = openApiRoute(userHeadshotPutRouteSchema, onPut);

export const UserHeadshotDelete = openApiRoute(userHeadshotDeleteRouteSchema, onDelete);
