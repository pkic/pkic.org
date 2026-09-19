import {
  mailingListSyncGetRouteSchema,
  mailingListSyncUpdateRouteSchema,
  mailingListSyncRunRouteSchema,
} from "../../../../../../../assets/shared/schemas/mailing-list-sync";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  getMailingListSyncSettings,
  updateMailingListSyncSettings,
  runMailingListSync,
} from "../../../../../../_lib/services/google-groups/mailing-list-settings";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";
async function syncContext(c: AdminContext, groupId: string) {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, groupId);
  return { db, groupId: context.group.id, actor: requireGroupManagementActor(context) };
}
export const MailingListSyncGet = openApiRoute(mailingListSyncGetRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, groupId } = await syncContext(c, data.params.groupId);
  return json(await getMailingListSyncSettings(db, actor, groupId, data.params.listId));
});
export const MailingListSyncUpdate = openApiRoute(mailingListSyncUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, groupId } = await syncContext(c, data.params.groupId);
  return json(await updateMailingListSyncSettings(db, actor, groupId, data.params.listId, data.body));
});
export const MailingListSyncRun = openApiRoute(mailingListSyncRunRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, groupId } = await syncContext(c, data.params.groupId);
  return json(await runMailingListSync(db, actor, groupId, data.params.listId, data.body));
});
