import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listEffectiveGroupMailingListSubscriptions } from "../../../../../_lib/services/mailing-list-subscriptions";
import { createGroupMailingList } from "../../../../../_lib/services/mailing-list-management/commands";
import { getVisibleGroup } from "../../../../../_lib/services/groups";
import { AppError } from "../../../../../_lib/errors";
import {
  effectiveMailingListSubscriptionsResponseSchema,
  groupMailingListCreateRouteSchema,
  groupMailingListSubscriptionsRouteSchema,
  mailingListResponseSchema,
} from "../../../../../../assets/shared/schemas/mailing-lists";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../group-resource-context";

export const GroupMailingListSubscriptions = openApiRoute(
  groupMailingListSubscriptionsRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const group = await getVisibleGroup(db, data.params.groupId, { userId: member.userId, canReadAll: false });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
    return json(
      effectiveMailingListSubscriptionsResponseSchema.parse(
        await listEffectiveGroupMailingListSubscriptions(db, member.userId, group.id, data.query),
      ),
    );
  },
);

export const GroupMailingListCreate = openApiRoute(groupMailingListCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const actor = requireGroupManagementActor(context.viewer);
  const mailingList = await createGroupMailingList(db, actor, context.group.id, data.body);
  return json(mailingListResponseSchema.parse({ mailingList }), 201);
});
