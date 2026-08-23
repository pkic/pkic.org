/**
 * PATCH /api/v1/admin/votes/:id — update a vote's settings.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requireVoteManagementAccess } from "../../../../../_lib/auth/vote-access";
import { updateVoteSettings } from "../../../../../_lib/services/votes";
import {
  adminVoteMutationResponseSchema,
  adminVoteUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/votes-admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminVotePatch = openApiRoute(adminVoteUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;

  await requireVoteManagementAccess(db, admin, id);

  const body = data.body;
  const vote = await updateVoteSettings(db, admin, id, body);

  return json(adminVoteMutationResponseSchema.parse({ vote }));
});
