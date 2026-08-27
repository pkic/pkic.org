import {
  groupEventRegistrationSettingsGetRouteSchema,
  groupEventRegistrationSettingsResponseSchema,
  groupEventRegistrationSettingsPutRouteSchema,
  groupEventRegistrationFormCreateRouteSchema,
  groupEventRegistrationFormCreateSchema,
  groupEventRegistrationFormsListRouteSchema,
  groupEventRegistrationFormsResponseSchema,
} from "../../../../../../../assets/shared/schemas/group-events";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  getGroupEventRegistrationSettings,
  replaceGroupEventRegistrationSettings,
  createGroupEventRegistrationForm,
  listGroupEventRegistrationForms,
} from "../../../../../../_lib/services/events/registration-settings";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupEventRegistrationSettingsGet = openApiRoute(
  groupEventRegistrationSettingsGetRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await getGroupEventRegistrationSettings(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
    );
    return json(groupEventRegistrationSettingsResponseSchema.parse(result));
  },
);

export const GroupEventRegistrationSettingsPut = openApiRoute(
  groupEventRegistrationSettingsPutRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await replaceGroupEventRegistrationSettings(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.body.expectedUpdatedAt,
      data.body.registrationPolicy,
      data.body.formId,
    );
    return json(groupEventRegistrationSettingsResponseSchema.parse(result));
  },
);

export const GroupEventRegistrationFormCreate = openApiRoute(
  groupEventRegistrationFormCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await createGroupEventRegistrationForm(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      groupEventRegistrationFormCreateSchema.parse(data.body),
    );
    return json(groupEventRegistrationSettingsResponseSchema.parse(result), 201);
  },
);

export const GroupEventRegistrationFormsList = openApiRoute(
  groupEventRegistrationFormsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await listGroupEventRegistrationForms(
      db,
      requireGroupManagementActor(context),
      context.group.id,
      data.params.eventId,
      data.query,
    );
    return json(
      groupEventRegistrationFormsResponseSchema.parse({
        forms: result.rows,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.rows.length),
      }),
    );
  },
);
