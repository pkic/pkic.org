import {
  groupFormDefinitionMutationResponseSchema,
  groupFormDefinitionRouteSchema,
  groupFormDefinitionUpdateRouteSchema,
  groupFormPlacementUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/group-forms";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  getGroupFormDefinition,
  updateGroupFormDefinition,
  updateGroupFormPlacement,
} from "../../../../../_lib/services/forms";
import { requireGroupResourceContext } from "../../group-resource-context";

export const GroupFormDefinitionGet = openApiRoute(groupFormDefinitionRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  return json(await getGroupFormDefinition(db, viewer, group.id, data.params.placementId));
});

export const GroupFormPlacementUpdate = openApiRoute(
  groupFormPlacementUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    if (!viewer.admin || viewer.admin.identityType !== "user") {
      throw new AppError(403, "GROUP_FORM_MANAGEMENT_REQUIRED", "A staff identity with form management is required");
    }
    return json(await updateGroupFormPlacement(db, viewer.admin, group.id, data.params.placementId, data.body));
  },
);

export const GroupFormDefinitionUpdate = openApiRoute(
  groupFormDefinitionUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    if (!viewer.admin || viewer.admin.identityType !== "user") {
      throw new AppError(403, "GROUP_FORM_MANAGEMENT_REQUIRED", "Effective group management permission is required");
    }
    const updated = await updateGroupFormDefinition(db, viewer.admin, group.id, data.params.placementId, data.body);
    return json(groupFormDefinitionMutationResponseSchema.parse({ success: true, ...updated }));
  },
);
