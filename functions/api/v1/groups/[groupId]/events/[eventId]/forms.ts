import {
  groupEventFormCreateRouteSchema,
  groupEventFormGetRouteSchema,
  groupEventFormPutRouteSchema,
  groupEventFormResponseSchema,
  groupEventFormsListRouteSchema,
  groupEventFormsResponseSchema,
} from "../../../../../../../assets/shared/schemas/group-event-forms";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  createGroupEventForm,
  getGroupEventForm,
  listGroupEventAvailableForms,
  replaceGroupEventForm,
} from "../../../../../../_lib/services/events/form-placement";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupEventFormGet = openApiRoute(groupEventFormGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await getGroupEventForm(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
    data.params.purpose,
  );
  return json(groupEventFormResponseSchema.parse(result));
});

export const GroupEventFormPut = openApiRoute(groupEventFormPutRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await replaceGroupEventForm(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
    data.params.purpose,
    data.body.expectedUpdatedAt,
    data.body.formId,
  );
  return json(groupEventFormResponseSchema.parse(result));
});

export const GroupEventFormCreate = openApiRoute(groupEventFormCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await createGroupEventForm(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
    data.params.purpose,
    data.body.expectedUpdatedAt,
    data.body.definition,
  );
  return json(groupEventFormResponseSchema.parse(result), 201);
});

export const GroupEventFormsList = openApiRoute(groupEventFormsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await listGroupEventAvailableForms(
    db,
    requireGroupManagementActor(context),
    context.group.id,
    data.params.eventId,
    data.params.purpose,
    data.query,
  );
  return json(
    groupEventFormsResponseSchema.parse({
      forms: result.rows,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.rows.length),
    }),
  );
});
