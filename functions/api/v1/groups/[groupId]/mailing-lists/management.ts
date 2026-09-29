import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import {
  groupMailingListManagementRouteSchema,
  mailingListsListResponseSchema,
} from "../../../../../../assets/shared/schemas/mailing-lists";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listGroupManagedMailingLists } from "../../../../../_lib/services/mailing-list-management/read-model";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../group-resource-context";

/** Manager-only configuration view; participant preferences remain on the sibling collection route. */
export const GroupMailingListManagementList = openApiRoute(
  groupMailingListManagementRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const actor = requireGroupManagementActor(context);
    const result = await listGroupManagedMailingLists(db, actor, context.group.id, data.query);
    return json(
      mailingListsListResponseSchema.parse({
        mailingLists: result.mailingLists,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.mailingLists.length),
      }),
    );
  },
);
