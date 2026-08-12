/**
 * PATCH  /api/v1/admin/mailing-lists/:id — edit label/type/category rules/associated WG/active state
 * DELETE /api/v1/admin/mailing-lists/:id — delete a mailing list entry
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { deleteMailingList, updateMailingList } from "../../../../../_lib/services/mailing-lists";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  mailingListDeleteRouteSchema,
  mailingListUpdateRouteSchema,
  mailingListUpdateSchema,
} from "../../../../../../assets/shared/schemas/admin-mailing-lists";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  const body = await parseJsonBody(c.req, mailingListUpdateSchema);
  const mailingList = await updateMailingList(db, id, body);
  await writeAuditLog(db, "admin", admin.id, "mailing_list_updated", "mailing_list", id, body);
  return json({ mailingList });
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  await deleteMailingList(db, id);
  await writeAuditLog(db, "admin", admin.id, "mailing_list_deleted", "mailing_list", id, {});
  return json({ success: true });
}

export class MailingListUpdate extends OpenAPIRoute {
  schema = mailingListUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

export class MailingListDelete extends OpenAPIRoute {
  schema = mailingListDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
