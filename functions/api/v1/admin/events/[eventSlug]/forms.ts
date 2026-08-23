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
import { adminFormCreateResponseSchema } from "../../../../../../assets/shared/schemas/admin-forms";
import {
  adminEventFormCreateRouteSchema,
  adminEventFormsListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

export const onRequestGet = openApiRoute(adminEventFormsListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
  const { limit, offset, q, sort, purpose, status } = data.query;
  const { forms, total } = await listAdminForms(requestDb(c), {
    eventId: event.id,
    includeGlobal: true,
    limit,
    offset,
    q,
    sort,
    purpose,
    status,
  });
  return json({ forms, page: buildPageInfo(limit, offset, total, forms.length) });
});

export const AdminEventFormsCreate = openApiRoute(adminEventFormCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);

  const form = await createManagedForm(
    requestDb(c),
    admin.id,
    { type: "event", ref: event.id, eventSlug: event.slug },
    data.body,
  );
  return json(adminFormCreateResponseSchema.parse({ success: true, formId: form.id, key: form.key }), 201);
});
