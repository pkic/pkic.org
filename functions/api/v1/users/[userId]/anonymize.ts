import type { ValidatedData } from "chanfana";
import {
  userAnonymizeResponseSchema,
  userAnonymizeRouteSchema,
} from "../../../../../assets/shared/schemas/user-management";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { removePreviousHeadshot } from "../../../../_lib/services/user-headshot";
import { anonymizeUser } from "../../../../_lib/services/user-anonymization";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireUserStaffPermission } from "../authorization";

async function handleUserAnonymization(
  c: AdminContext,
  data: ValidatedData<typeof userAnonymizeRouteSchema>,
): Promise<Response> {
  const { db, staff } = await requireUserStaffPermission(c, "users:anonymize");
  const result = await anonymizeUser(db, staff, data.params.userId);
  c.executionCtx.waitUntil(removePreviousHeadshot(db, c.env, result.previousHeadshotKey));
  return json(userAnonymizeResponseSchema.parse({ success: true, userId: result.userId }));
}

export const UserAnonymizePost = openApiRoute(userAnonymizeRouteSchema, handleUserAnonymization);
