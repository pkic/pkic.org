/**
 * POST /api/v1/admin/users/:userId/merge — merge another account (body.sourceUserId)
 * into this one (:userId is the survivor -- "absorb this other account into me").
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { mergeUsers } from "../../../../../_lib/services/user-merge";
import { userMergeRouteSchema } from "../../../../../../assets/shared/schemas/user-emails";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const UserMerge = openApiRoute(userMergeRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:write");

  const survivorId = data.params.userId;
  const body = data.body;
  const result = await mergeUsers(requestDb(c), {
    survivorId,
    sourceUserId: body.sourceUserId,
    actorUserId: admin.id,
  });

  return json(result);
});
