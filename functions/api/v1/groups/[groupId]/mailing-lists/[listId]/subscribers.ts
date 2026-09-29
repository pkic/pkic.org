import {
  groupMailingListSubscribersRouteSchema,
  mailingListSubscribersResponseSchema,
} from "../../../../../../../assets/shared/schemas/mailing-lists";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireManagedGroupMailingList } from "../../../../../../_lib/services/mailing-list-management/authorization";
import { listMailingListSubscribers } from "../../../../../../_lib/services/mailing-list-subscriptions";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

/** Who a list reaches is member data, so the roster is a management view rather than a participant one. */
export const GroupMailingListSubscribersList = openApiRoute(
  groupMailingListSubscribersRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const actor = requireGroupManagementActor(context);
    await requireManagedGroupMailingList(db, actor, context.group.id, data.params.listId);
    return json(
      mailingListSubscribersResponseSchema.parse(await listMailingListSubscribers(db, data.params.listId, data.query)),
    );
  },
);
