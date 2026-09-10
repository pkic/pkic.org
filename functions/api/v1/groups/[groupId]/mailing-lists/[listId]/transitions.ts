import {
  groupMailingListTransitionRouteSchema,
  mailingListResponseSchema,
} from "../../../../../../../assets/shared/schemas/mailing-lists";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { transitionGroupMailingList } from "../../../../../../_lib/services/mailing-list-management/lifecycle";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

/** Archiving and restoring are one state moving in two directions, so they share one endpoint. */
export const GroupMailingListTransitionPost = openApiRoute(
  groupMailingListTransitionRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const actor = requireGroupManagementActor(context);
    const mailingList = await transitionGroupMailingList(db, actor, context.group.id, data.params.listId, data.body);
    return json(mailingListResponseSchema.parse({ mailingList }));
  },
);
