import {
  groupFormCreateRouteSchema,
  groupFormDefinitionMutationResponseSchema,
  groupFormsListResponseSchema,
  groupFormsListRouteSchema,
} from "../../../../../../assets/shared/schemas/group-forms";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { createGroupFormDefinition, listGroupFormPlacements } from "../../../../../_lib/services/forms";
import { AppError } from "../../../../../_lib/errors";
import { requireGroupResourceContext } from "../../group-resource-context";

export const GroupFormsList = openApiRoute(groupFormsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await listGroupFormPlacements(db, viewer, group.id, data.query);
  return json(
    groupFormsListResponseSchema.parse({
      forms: result.forms,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.forms.length),
    }),
  );
});

export const GroupFormCreate = openApiRoute(groupFormCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  if (!viewer.admin || viewer.admin.identityType !== "user") {
    throw new AppError(403, "GROUP_FORM_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  }
  const created = await createGroupFormDefinition(db, viewer.admin, group.id, data.body);
  return json(groupFormDefinitionMutationResponseSchema.parse({ success: true, ...created }), 201);
});
