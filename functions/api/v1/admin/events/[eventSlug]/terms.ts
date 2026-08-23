/**
 * GET  /api/v1/admin/events/:eventSlug/terms
 *   Returns all active terms for the event, grouped by audience type.
 *
 * PUT  /api/v1/admin/events/:eventSlug/terms
 *   Replaces all attendee and speaker terms for the event.
 *   Deactivates existing terms, then upserts the submitted set.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import {
  listConfiguredEventTerms,
  replaceConfiguredEventTerms,
} from "../../../../../_lib/services/events/term-configuration";
import {
  adminEventTermsReplaceSchema,
  adminEventTermsResponseSchema,
} from "../../../../../../assets/shared/schemas/admin-events";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const terms = await listConfiguredEventTerms(requestDb(c), event.id);
  return json({ terms });
}

export async function onRequestPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventTermsReplaceSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  await replaceConfiguredEventTerms(requestDb(c), admin.id, event.id, body);

  const updatedTerms = await listConfiguredEventTerms(requestDb(c), event.id);
  return json(adminEventTermsResponseSchema.parse({ terms: updatedTerms }));
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet, PUT: onRequestPut });
}
