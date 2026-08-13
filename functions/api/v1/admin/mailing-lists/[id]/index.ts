/**
 * PATCH  /api/v1/admin/mailing-lists/:id — edit label/type/category rules/associated WG/active state
 * DELETE /api/v1/admin/mailing-lists/:id — delete a mailing list entry
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { deleteMailingList, updateMailingList } from "../../../../../_lib/services/mailing-lists";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  mailingListDeleteRouteSchema,
  mailingListUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-mailing-lists";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const MailingListUpdate = openApiRoute(mailingListUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  const body = data.body;
  const mailingList = await updateMailingList(db, id, body);
  await writeAuditLog(db, "admin", admin.id, "mailing_list_updated", "mailing_list", id, body);
  return json({ mailingList });
});

export const MailingListDelete = openApiRoute(mailingListDeleteRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  await deleteMailingList(db, id);
  await writeAuditLog(db, "admin", admin.id, "mailing_list_deleted", "mailing_list", id, {});
  return json({ success: true });
});
