import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { resolveOptionalGroupViewer } from "../../../_lib/auth/group-access";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { createGroup, listGroups } from "../../../_lib/services/groups";
import {
  groupCreateRouteSchema,
  groupsListRouteSchema,
} from "../../../../assets/shared/schemas/route-contracts-groups";
import { groupsListResponseSchema } from "../../../../assets/shared/schemas/groups";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";

export const GroupsList = openApiRoute(groupsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const viewer = await resolveOptionalGroupViewer(db, c.req.raw, c.env);
  const query = viewer.canReadAll ? data.query : { ...data.query, active: true };
  const { groups, total } = await listGroups(db, query, {
    userId: viewer.userId,
    canReadAll: viewer.canReadAll,
  });
  return json(
    groupsListResponseSchema.parse({
      groups,
      page: buildPageInfo(query.limit, query.offset, total, groups.length),
    }),
  );
});

export const GroupsCreate = openApiRoute(groupCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json({ group: await createGroup(db, admin, data.body) }, 201);
});
