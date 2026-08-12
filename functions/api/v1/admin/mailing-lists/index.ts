/**
 * GET  /api/v1/admin/mailing-lists — list all managed mailing lists
 * POST /api/v1/admin/mailing-lists — add a new one
 *
 * Admin role required — not a named permission (see
 * assets/shared/schemas/admin-mailing-lists.ts's header note).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { createMailingList, listMailingLists } from "../../../../_lib/services/mailing-lists";
import { writeAuditLog } from "../../../../_lib/services/audit";
import {
  mailingListCreateRouteSchema,
  mailingListCreateSchema,
  mailingListsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-mailing-lists";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  const mailingLists = await listMailingLists(db);
  return json({ mailingLists });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, mailingListCreateSchema);
  const mailingList = await createMailingList(db, body);
  await writeAuditLog(db, "admin", admin.id, "mailing_list_created", "mailing_list", mailingList.id, {
    email: mailingList.email,
  });
  return json({ mailingList }, 201);
}

export class MailingListsList extends OpenAPIRoute {
  schema = mailingListsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class MailingListsCreate extends OpenAPIRoute {
  schema = mailingListCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
