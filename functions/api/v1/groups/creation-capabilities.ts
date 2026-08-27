import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { canCreateGroup } from "../../../_lib/services/groups";
import { groupCreationCapabilitiesRouteSchema } from "../../../../assets/shared/schemas/route-contracts-groups";
import { groupCreationCapabilitiesResponseSchema } from "../../../../assets/shared/schemas/groups";

export const GroupCreationCapabilitiesGet = openApiRoute(
  groupCreationCapabilitiesRouteSchema,
  async (c: AdminContext) => {
    const db = requestDb(c);
    let canCreate = false;
    try {
      const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
      canCreate = await canCreateGroup(db, admin);
    } catch (error) {
      if (!(error instanceof AppError) || ![401, 403].includes(error.status)) throw error;
    }
    return json(groupCreationCapabilitiesResponseSchema.parse({ canCreate }));
  },
);
