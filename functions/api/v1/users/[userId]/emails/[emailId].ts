/**
 * DELETE /api/v1/users/:userId/emails/:emailId — remove a secondary email
 */
import { json } from "../../../../../_lib/http";
import { removeUserEmail } from "../../../../../_lib/services/user-emails";
import { userEmailRemoveRouteSchema } from "../../../../../../assets/shared/schemas/user-emails";
import type { AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireUserStaffPermission } from "../../authorization";

export const UserEmailsRemove = openApiRoute(userEmailRemoveRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireUserStaffPermission(c, "users:write");

  const userId = data.params.userId;
  const emailId = data.params.emailId;
  await removeUserEmail(db, staff, userId, emailId);

  return json({ success: true });
});
