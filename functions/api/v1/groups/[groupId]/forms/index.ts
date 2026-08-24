import {
  groupFormsListResponseSchema,
  groupFormsListRouteSchema,
} from "../../../../../../assets/shared/schemas/group-forms";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listGroupFormPlacements } from "../../../../../_lib/services/forms";
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
