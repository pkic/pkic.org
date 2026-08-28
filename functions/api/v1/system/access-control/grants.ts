import {
  accessGrantCreateResponseSchema,
  accessGrantsCreateRouteSchema,
  accessGrantsListRouteSchema,
  accessGrantRevokeRouteSchema,
} from "../../../../../assets/shared/schemas/access-control";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  createAccessGrant,
  listAccessGrants,
  revokeAccessGrant,
} from "../../../../_lib/services/access-control/access-grants";
import { requireSystemAnyPermission, requireSystemPermission } from "../authorization";

export const SystemAccessGrantsList = openApiRoute(accessGrantsListRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(await listAccessGrants(db, staff, data.query));
});

export const SystemAccessGrantsCreate = openApiRoute(accessGrantsCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemPermission(c, "access:grant");
  return json(
    accessGrantCreateResponseSchema.parse({
      grant: await createAccessGrant(db, staff, data.body),
    }),
    201,
  );
});

export const SystemAccessGrantsRevoke = openApiRoute(accessGrantRevokeRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemPermission(c, "access:revoke");
  await revokeAccessGrant(db, staff, data.params.id);
  return json({ success: true });
});
