import { json } from "../../../../_lib/http";
import { guardMemberSessionMutationDatabase, requireMemberFromRequest } from "../../../../_lib/auth/member";
import { readValidatedUploadedImage, resizeHeadshot } from "../../../../_lib/utils/image-upload";
import {
  getUserHeadshotRecord,
  uploadUserHeadshotForRequest,
  userHeadshotTargetGuard,
} from "../../../../_lib/services/user-headshot";
import { myHeadshotUploadResponseSchema, myHeadshotUploadRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const CurrentUserHeadshotPut = openApiRoute(myHeadshotUploadRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const user = await getUserHeadshotRecord(db, member.userId);
  const uploaded = await readValidatedUploadedImage(c.req.raw, "Headshot");
  const resized = await resizeHeadshot(uploaded.buffer, c.env.IMAGES);
  await uploadUserHeadshotForRequest(
    guardMemberSessionMutationDatabase(db, member),
    c.env,
    c.req.raw,
    c.executionCtx.waitUntil.bind(c.executionCtx),
    {
      userId: member.userId,
      previousKey: user.headshot_r2_key,
      image: resized,
      source: "current_user_upload",
      audit: { actorType: "member", actorId: member.userId, action: "headshot_uploaded" },
      commitGuard: userHeadshotTargetGuard(user),
    },
  );

  return json(myHeadshotUploadResponseSchema.parse({ success: true }));
});
