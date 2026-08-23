/**
 * GET  /api/v1/admin/events/:eventSlug/terms
 *   Returns all active terms for the event, grouped by audience type.
 *
 * PUT  /api/v1/admin/events/:eventSlug/terms
 *   Replaces all attendee and speaker terms for the event.
 *   Deactivates existing terms, then upserts the submitted set.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import {
  listConfiguredEventTerms,
  replaceConfiguredEventTerms,
} from "../../../../../_lib/services/events/term-configuration";
import { adminEventTermsResponseSchema } from "../../../../../../assets/shared/schemas/admin-events";
import {
  adminEventTermsGetRouteSchema,
  adminEventTermsReplaceRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-admin-events";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const AdminEventsEventSlugTermsGet = openApiRoute(
  adminEventTermsGetRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
    const terms = await listConfiguredEventTerms(requestDb(c), event.id);
    return json(adminEventTermsResponseSchema.parse({ terms }));
  },
);

export const AdminEventsEventSlugTermsPut = openApiRoute(
  adminEventTermsReplaceRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);

    await replaceConfiguredEventTerms(requestDb(c), admin.id, event.id, data.body);

    const updatedTerms = await listConfiguredEventTerms(requestDb(c), event.id);
    return json(adminEventTermsResponseSchema.parse({ terms: updatedTerms }));
  },
);
