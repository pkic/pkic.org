/**
 * The caller's own headshot.
 *
 * PUT    /api/v1/users/current/headshot — upload / replace
 * DELETE /api/v1/users/current/headshot — remove
 *
 * Both act on the identity resolved from the shared human session; neither
 * accepts a target-user parameter.
 */
import { json } from "../../../../_lib/http";
import { guardMemberSessionMutationDatabase, requireMemberFromRequest } from "../../../../_lib/auth/member";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../../_lib/utils/image-upload";
import {
  getUserHeadshotRecord,
  removeUserHeadshotForRequest,
  uploadUserHeadshotForRequest,
  userHeadshotTargetGuard,
  type UserHeadshotRecord,
} from "../../../../_lib/services/user-headshot";
import {
  myHeadshotDeleteResponseSchema,
  myHeadshotDeleteRouteSchema,
  myHeadshotUploadResponseSchema,
  myHeadshotUploadRouteSchema,
} from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { DatabaseLike } from "../../../../_lib/types";

interface CurrentUserHeadshotTarget {
  userId: string;
  user: UserHeadshotRecord;
  /** Writes are guarded by the exact session and membership that authorized them. */
  db: DatabaseLike;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** Resolves the caller's own live headshot record and the database its writes must commit through. */
async function currentUserHeadshotTarget(c: AdminContext): Promise<CurrentUserHeadshotTarget> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const user = await getUserHeadshotRecord(db, member.userId);
  return {
    userId: member.userId,
    user,
    db: guardMemberSessionMutationDatabase(db, member),
    waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
  };
}

export const CurrentUserHeadshotPut = openApiRoute(myHeadshotUploadRouteSchema, async (c: AdminContext) => {
  const target = await currentUserHeadshotTarget(c);
  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const resized = await resizeHeadshot(uploaded.buffer, c.env.IMAGES);
  await uploadUserHeadshotForRequest(target.db, c.env, c.req.raw, target.waitUntil, {
    userId: target.userId,
    previousKey: target.user.headshot_r2_key,
    image: resized,
    source: "current_user_upload",
    audit: { actorType: "member", actorId: target.userId, action: "headshot_uploaded" },
    commitGuard: userHeadshotTargetGuard(target.user),
  });

  return json(myHeadshotUploadResponseSchema.parse({ success: true }));
});

export const CurrentUserHeadshotDelete = openApiRoute(myHeadshotDeleteRouteSchema, async (c: AdminContext) => {
  const target = await currentUserHeadshotTarget(c);
  await removeUserHeadshotForRequest(target.db, c.env, c.req.raw, target.waitUntil, {
    userId: target.userId,
    previousKey: target.user.headshot_r2_key,
    audit: { actorType: "member", actorId: target.userId, action: "headshot_removed" },
    commitGuard: userHeadshotTargetGuard(target.user),
  });

  return json(myHeadshotDeleteResponseSchema.parse({ success: true }));
});
