/** POST /api/v1/admin/users/:userId/anonymize — irreversible account redaction and access revocation. */
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { anonymizeAdminUser } from "../../../../../_lib/services/admin-user-anonymize";
import { removePreviousHeadshot } from "../../../../../_lib/services/user-headshot";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import type { ValidatedData } from "chanfana";
import {
  adminUserAnonymizeResponseSchema,
  adminUserAnonymizeRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-users";

async function handleAnonymize(
  c: AdminContext,
  data: ValidatedData<typeof adminUserAnonymizeRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const result = await anonymizeAdminUser(requestDb(c), admin, data.params.userId);
  c.executionCtx.waitUntil(removePreviousHeadshot(requestDb(c), c.env, result.previousHeadshotKey));
  return json(adminUserAnonymizeResponseSchema.parse({ success: true, userId: result.userId }));
}

export const AdminUsersUserIdAnonymizePost = openApiRoute(adminUserAnonymizeRouteSchema, handleAnonymize);
