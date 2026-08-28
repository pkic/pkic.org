import {
  accessControlContextsListResponseSchema,
  accessControlContextsListRouteSchema,
  accessControlUsersListRouteSchema,
} from "../../../../../assets/shared/schemas/access-control";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listAccessControlContexts } from "../../../../_lib/services/access-control/catalogs";
import { listUserCatalog } from "../../../../_lib/services/user-catalog";
import { requireStaffAnyPermission } from "../../../../_lib/auth/staff-permissions";

export const SystemAccessControlUsersList = openApiRoute(
  accessControlUsersListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
    return json(await listUserCatalog(db, data.query));
  },
);

export const SystemAccessControlContextsList = openApiRoute(
  accessControlContextsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
    return json(accessControlContextsListResponseSchema.parse(await listAccessControlContexts(db, data.query)));
  },
);
