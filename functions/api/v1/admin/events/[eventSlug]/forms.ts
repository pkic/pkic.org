/**
 * GET  /api/v1/admin/events/:eventSlug/forms
 *   Lists all forms scoped to this event (by event_id as scope_ref),
 *   plus any global fallback forms, for all purposes.
 *
 * POST /api/v1/admin/events/:eventSlug/forms
 *   Creates a new form scoped to this event.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { createManagedForm, listAdminForms } from "../../../../../_lib/services/forms";
import {
  adminFormCreateResponseSchema,
  adminFormsListResponseSchema,
} from "../../../../../../assets/shared/schemas/admin-forms";
import {
  adminEventFormCreateRouteSchema,
  adminEventFormsListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { AppError } from "../../../../../_lib/errors";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../../../../_lib/db/authorization-guard";

export const onRequestGet = openApiRoute(adminEventFormsListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
  const { forms, total } = await listAdminForms(requestDb(c), {
    ...data.query,
    eventId: event.id,
    includeGlobal: true,
  });
  return json(
    adminFormsListResponseSchema.parse({
      forms,
      page: buildPageInfo(data.query.limit, data.query.offset, total, forms.length),
    }),
  );
});

export const AdminEventFormsCreate = openApiRoute(adminEventFormCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
  const registrationForm = data.body.purpose === "event_registration";
  let form: Awaited<ReturnType<typeof createManagedForm>>;
  try {
    form = await createManagedForm(
      requestDb(c),
      admin.id,
      { type: "event", ref: event.id, eventSlug: event.slug },
      data.body,
      registrationForm
        ? {
            authorizationGuards: [
              prepareAuthorizationGuard(requestDb(c), {
                sql: "SELECT 1 FROM events WHERE id = ? AND COALESCE(source_mode, '') <> 'portal'",
                bindings: [event.id],
              }),
            ],
          }
        : undefined,
    );
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        403,
        "PORTAL_EVENT_REGISTRATION_OWNED_BY_GROUP",
        "Attendee forms for portal-owned events must be created and managed from the owning group.",
      );
    }
    throw error;
  }
  return json(
    adminFormCreateResponseSchema.parse({
      success: true,
      formId: form.id,
      placementId: form.placementId,
      key: form.key,
    }),
    201,
  );
});
