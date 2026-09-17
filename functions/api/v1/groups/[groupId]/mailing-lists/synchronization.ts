import {
  groupMailingSyncGetRouteSchema,
  groupMailingSyncUpdateRouteSchema,
  groupMailingSyncRunRouteSchema,
} from "../../../../../../assets/shared/schemas/group-mailing-sync";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  getGroupMailingSyncSettings,
  updateGroupMailingSyncSettings,
  runGroupMailingSync,
} from "../../../../../_lib/services/google-groups/group-settings";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../group-resource-context";
async function syncContext(c: AdminContext, groupId: string) {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, groupId);
  return { db, groupId: context.group.id, actor: requireGroupManagementActor(context) };
}
export const GroupMailingSyncGet = openApiRoute(groupMailingSyncGetRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, groupId } = await syncContext(c, data.params.groupId);
  return json(await getGroupMailingSyncSettings(db, actor, groupId));
});
export const GroupMailingSyncUpdate = openApiRoute(groupMailingSyncUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, groupId } = await syncContext(c, data.params.groupId);
  return json(await updateGroupMailingSyncSettings(db, actor, groupId, data.body));
});
export const GroupMailingSyncRun = openApiRoute(groupMailingSyncRunRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, groupId } = await syncContext(c, data.params.groupId);
  return json(await runGroupMailingSync(db, actor, groupId, data.body));
});
