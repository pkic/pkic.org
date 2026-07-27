/**
 * POST /api/v1/admin/users/:userId/merge — merge another account (body.sourceUserId)
 * into this one (:userId is the survivor -- "absorb this other account into me").
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { mergeUsers } from "../../../../../_lib/services/user-merge";
import { userMergeSchema, userMergeRouteSchema } from "../../../../../../assets/shared/schemas/user-emails";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:write");

  const survivorId = c.req.param("userId");
  const body = await parseJsonBody(c.req, userMergeSchema);
  const result = await mergeUsers(requestDb(c), { survivorId, sourceUserId: body.sourceUserId });

  await writeAuditLog(requestDb(c), "admin", admin.id, "users_merged", "user", result.survivorId, {
    mergedFromUserId: result.mergedFromUserId,
    mergedFromEmail: result.mergedFromEmail,
  });

  return json(result);
}

export class UserMerge extends OpenAPIRoute {
  schema = userMergeRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
