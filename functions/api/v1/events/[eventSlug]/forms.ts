import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import {
  formCreateResponseSchema,
  formsListResponseSchema,
} from "../../../../../assets/shared/schemas/form-management";
import {
  eventFormCreateRouteSchema,
  eventFormsListRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-forms";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../../../_lib/db/authorization-guard";
import type { AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { createManagedForm, listForms } from "../../../../_lib/services/forms";
import { guardedEventFormsDatabase, requireEventFormsPermission } from "./forms/authorization";

export const EventFormsListGet = openApiRoute(eventFormsListRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventFormsPermission(c, data.params.eventSlug, "events:read");
  const { linkedOnly, ...query } = data.query;
  const { forms, total } = await listForms(db, {
    ...query,
    eventId: event.id,
    includeGlobal: linkedOnly !== true,
    responseContext: { type: "event", ref: event.id },
  });
  return json(
    formsListResponseSchema.parse({
      forms,
      page: buildPageInfo(query.limit, query.offset, total, forms.length),
    }),
  );
});

export const EventFormsCreatePost = openApiRoute(eventFormCreateRouteSchema, async (c: AdminContext, data) => {
  const { actor, context, db, event } = await requireEventFormsPermission(c, data.params.eventSlug, "events:write");
  const eventFlowForm = data.body.purpose === "event_registration" || data.body.purpose === "proposal_submission";
  if (eventFlowForm && event.source_mode === "portal") {
    throw new AppError(
      403,
      "PORTAL_EVENT_FORMS_OWNED_BY_GROUP",
      "Event-flow forms for portal-owned events must be created and managed from the owning group",
    );
  }
  const guardedDb = guardedEventFormsDatabase(db, actor, context);
  try {
    const form = await createManagedForm(
      guardedDb,
      actor.id,
      { type: "event", ref: event.id, eventSlug: event.slug },
      data.body,
      eventFlowForm
        ? {
            authorizationGuards: [
              prepareAuthorizationGuard(guardedDb, {
                sql: "SELECT 1 FROM events WHERE id = ? AND COALESCE(source_mode, '') <> 'portal'",
                bindings: [event.id],
              }),
            ],
          }
        : undefined,
    );
    return json(
      formCreateResponseSchema.parse({
        success: true,
        formId: form.id,
        placementId: form.placementId,
        key: form.key,
      }),
      201,
    );
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        403,
        "PORTAL_EVENT_FORMS_OWNED_BY_GROUP",
        "Event-flow forms for portal-owned events must be created and managed from the owning group",
      );
    }
    throw error;
  }
});
