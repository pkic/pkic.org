import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listGroupTypes } from "../../../_lib/services/groups";
import { groupTypesListRouteSchema } from "../../../../assets/shared/schemas/route-contracts-groups";
import { groupTypesListResponseSchema } from "../../../../assets/shared/schemas/groups";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";

export const GroupTypesList = openApiRoute(groupTypesListRouteSchema, async (c: AdminContext, data) => {
  const query = { ...data.query, active: true };
  const { groupTypes, total } = await listGroupTypes(requestDb(c), query);
  return json(
    groupTypesListResponseSchema.parse({
      groupTypes,
      page: buildPageInfo(query.limit, query.offset, total, groupTypes.length),
    }),
  );
});
