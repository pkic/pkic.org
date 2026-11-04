import {
  groupEventDetailRouteSchema,
  groupEventSettingsUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/group-events";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getGroupEvent } from "../../../../../_lib/services/events/group-read-model";
import { updateGroupEventSettingsFromRequest } from "../../../../../_lib/services/events/group-settings-update";
import { requireGroupResourceContext } from "../../group-resource-context";

export const GroupEventDetailGet = openApiRoute(groupEventDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  return json(await getGroupEvent(db, viewer, group.id, data.params.eventId));
});

export const GroupEventSettingsPatch = openApiRoute(
  groupEventSettingsUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    return json(
      await updateGroupEventSettingsFromRequest(
        db,
        c.req.raw,
        c.env,
        data.params.groupId,
        data.params.eventId,
        data.body,
        resolveAppBaseUrl(c.env, c.req.raw),
      ),
    );
  },
);
