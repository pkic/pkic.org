/**
 * POST /api/v1/me/headshot — upload my headshot. Mirrors
 * admin/users/[userId]/headshot.ts's PUT handler (same upload/resize
 * pipeline, R2 bucket, and old-key cleanup) but scoped to the caller's own
 * identity — no target user id, member-session gated instead of admin.
 */
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { AppError } from "../../../_lib/errors";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../_lib/utils/image-upload";
import {
  getUserHeadshotPointer,
  removePreviousHeadshot,
  replaceUserHeadshot,
} from "../../../_lib/services/user-headshot";
import { myHeadshotUploadRouteSchema } from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";

export const MeHeadshotPost = openApiRoute(myHeadshotUploadRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  }

  const previousKey = await getUserHeadshotPointer(db, member.userId);
  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const resized = await resizeHeadshot(uploaded.buffer, uploaded.contentType, c.env.IMAGES);
  const r2Key = await replaceUserHeadshot({
    db,
    bucket,
    userId: member.userId,
    previousKey,
    image: resized,
    source: "member_self_upload",
    audit: { actorType: "member", actorId: member.userId, action: "headshot_uploaded" },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(db, c.env, previousKey));

  return json({ success: true, r2Key });
});
