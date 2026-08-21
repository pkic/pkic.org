/**
 * GET  /api/v1/admin/users/:userId/emails — list a user's secondary emails
 * POST /api/v1/admin/users/:userId/emails — add a secondary email
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { listUserEmails, addUserEmail } from "../../../../../../_lib/services/user-emails";
import {
  userEmailAddRouteSchema,
  userEmailsListRouteSchema,
} from "../../../../../../../assets/shared/schemas/user-emails";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const UserEmailsList = openApiRoute(userEmailsListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:read");

  const emails = await listUserEmails(requestDb(c), data.params.userId);
  return json({ emails });
});

export const UserEmailsAdd = openApiRoute(userEmailAddRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:write");

  const userId = data.params.userId;
  const body = data.body;
  const email = await addUserEmail(requestDb(c), admin, userId, body.email);

  return json({ email }, 201);
});
