/**
 * GET  /api/v1/admin/mailing-lists — list all managed mailing lists
 * POST /api/v1/admin/mailing-lists — add a new one
 *
 * Admin role required — not a named permission (see
 * assets/shared/schemas/admin-mailing-lists.ts's header note).
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { createMailingList, listMailingLists } from "../../../../_lib/services/mailing-lists";
import {
  mailingListCreateRouteSchema,
  mailingListResponseSchema,
  mailingListsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-mailing-lists";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const MailingListsList = openApiRoute(mailingListsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  const { limit, offset, q, sort } = data.query;
  const { mailingLists, total } = await listMailingLists(db, { limit, offset, q, sort });
  return json({ mailingLists, page: buildPageInfo(limit, offset, total, mailingLists.length) });
});

export const MailingListsCreate = openApiRoute(mailingListCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const body = data.body;
  const mailingList = await createMailingList(db, body, admin.id);
  return json(mailingListResponseSchema.parse({ mailingList }), 201);
});
