import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { setMailingListPreference } from "../../../../../_lib/services/mailing-list-subscriptions";
import {
  archiveGroupMailingList,
  updateGroupMailingList,
} from "../../../../../_lib/services/mailing-list-management/commands";
import { getVisibleGroup } from "../../../../../_lib/services/groups";
import { AppError } from "../../../../../_lib/errors";
import {
  groupMailingListArchiveRouteSchema,
  groupMailingListPreferenceRouteSchema,
  groupMailingListUpdateRouteSchema,
  mailingListPreferenceMutationResponseSchema,
  mailingListResponseSchema,
} from "../../../../../../assets/shared/schemas/mailing-lists";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../group-resource-context";

export const GroupMailingListPreferenceUpdate = openApiRoute(
  groupMailingListPreferenceRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const group = await getVisibleGroup(db, data.params.groupId, { userId: member.userId, canReadAll: false });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
    const subscription = await setMailingListPreference(
      db,
      member.userId,
      group.id,
      data.params.listId,
      data.body.preference,
    );
    return json(mailingListPreferenceMutationResponseSchema.parse({ success: true, subscription }));
  },
);

export const GroupMailingListUpdate = openApiRoute(groupMailingListUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const actor = requireGroupManagementActor(context);
  const mailingList = await updateGroupMailingList(db, actor, context.group.id, data.params.listId, data.body);
  return json(mailingListResponseSchema.parse({ mailingList }));
});

export const GroupMailingListArchive = openApiRoute(
  groupMailingListArchiveRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const actor = requireGroupManagementActor(context);
    await archiveGroupMailingList(db, actor, context.group.id, data.params.listId);
    return json({ success: true });
  },
);
