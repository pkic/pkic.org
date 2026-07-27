/**
 * GET  /api/v1/admin/users/:userId/emails — list a user's secondary emails
 * POST /api/v1/admin/users/:userId/emails — add a secondary email
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { listUserEmails, addUserEmail } from "../../../../../../_lib/services/user-emails";
import {
  userEmailAddSchema,
  userEmailAddRouteSchema,
  userEmailsListRouteSchema,
} from "../../../../../../../assets/shared/schemas/user-emails";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:read");

  const emails = await listUserEmails(requestDb(c), c.req.param("userId"));
  return json({ emails });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "users:write");

  const userId = c.req.param("userId");
  const body = await parseJsonBody(c.req, userEmailAddSchema);
  const email = await addUserEmail(requestDb(c), userId, body.email);

  await writeAuditLog(requestDb(c), "admin", admin.id, "user_email_added", "user", userId, { email: body.email });

  return json({ email }, 201);
}

export class UserEmailsList extends OpenAPIRoute {
  schema = userEmailsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class UserEmailsAdd extends OpenAPIRoute {
  schema = userEmailAddRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
