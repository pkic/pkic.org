import {
  sponsorLeadsRouteSchema,
  sponsorLeadSponsorsRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-sponsor-leads";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../_lib/services/events";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { listSponsorLeads, listLeadSponsors } from "../../../../_lib/services/event-participation/lead-list";
import { requireSponsorLeadPermission } from "./sponsor-authorization";

export const SponsorLeadsGet = openApiRoute(sponsorLeadsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireSponsorLeadPermission(
    c,
    data.params.eventSlug,
    data.params.sponsorId,
    "agenda:leads_view",
  );
  return json(await listSponsorLeads(db, event.id, data.params.sponsorId, actor.id, data.query));
});
export const SponsorLeadSponsorsGet = openApiRoute(sponsorLeadSponsorsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(await listLeadSponsors(db, event.id, actor.id, data.query));
});
import { sponsorLeadCapturesRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-sponsor-leads";
import { listSponsorLeadCaptures } from "../../../../_lib/services/event-participation/lead-list";
export const SponsorLeadCapturesGet = openApiRoute(sponsorLeadCapturesRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireSponsorLeadPermission(
    c,
    data.params.eventSlug,
    data.params.sponsorId,
    "agenda:leads_view",
  );
  return json(
    await listSponsorLeadCaptures(db, event.id, data.params.sponsorId, data.params.leadId, actor.id, data.query),
  );
});
