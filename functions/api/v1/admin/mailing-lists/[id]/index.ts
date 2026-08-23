/**
 * PATCH  /api/v1/admin/mailing-lists/:id — edit label/type/category rules/associated WG/active state
 * DELETE /api/v1/admin/mailing-lists/:id — delete a mailing list entry
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { deleteMailingList, updateMailingList } from "../../../../../_lib/services/mailing-lists";
import {
  mailingListDeleteRouteSchema,
  mailingListResponseSchema,
  mailingListUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-mailing-lists";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const MailingListUpdate = openApiRoute(mailingListUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  const body = data.body;
  const mailingList = await updateMailingList(db, id, body, admin.id);
  return json(mailingListResponseSchema.parse({ mailingList }));
});

export const MailingListDelete = openApiRoute(mailingListDeleteRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  await deleteMailingList(db, id, admin.id);
  return json({ success: true });
});
