/**
 * GET  /api/v1/users/:userId/emails — list a user's secondary emails
 * POST /api/v1/users/:userId/emails — add a secondary email
 */
import { json } from "../../../../../_lib/http";
import { listUserEmails, addUserEmail } from "../../../../../_lib/services/user-emails";
import {
  userEmailAddRouteSchema,
  userEmailAddResponseSchema,
  userEmailsListRouteSchema,
} from "../../../../../../assets/shared/schemas/user-emails";
import type { AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireUserStaffPermission } from "../../authorization";

export const UserEmailsList = openApiRoute(userEmailsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireUserStaffPermission(c, "users:read");
  return json(await listUserEmails(db, data.params.userId, data.query));
});

export const UserEmailsAdd = openApiRoute(userEmailAddRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireUserStaffPermission(c, "users:write");

  const userId = data.params.userId;
  const body = data.body;
  const email = await addUserEmail(db, staff, userId, body.email);

  return json(userEmailAddResponseSchema.parse({ email }), 201);
});
