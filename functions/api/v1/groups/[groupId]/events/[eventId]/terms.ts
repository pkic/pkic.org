import {
  groupEventTermsGetRouteSchema,
  groupEventTermsReplaceResponseSchema,
  groupEventTermsReplaceRouteSchema,
  groupEventTermsResponseSchema,
} from "../../../../../../../assets/shared/schemas/group-events";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  getGroupManagedEventTerms,
  replaceGroupManagedEventTerms,
} from "../../../../../../_lib/services/events/group-configuration";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupEventTermsGet = openApiRoute(groupEventTermsGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await getGroupManagedEventTerms(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
  );
  return json(groupEventTermsResponseSchema.parse(result));
});

export const GroupEventTermsPut = openApiRoute(groupEventTermsReplaceRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await replaceGroupManagedEventTerms(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
    data.body.expectedUpdatedAt,
    data.body.configuration,
  );
  return json(groupEventTermsReplaceResponseSchema.parse(result));
});
