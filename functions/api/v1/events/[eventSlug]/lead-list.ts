import {
  sponsorLeadsRouteSchema,
  sponsorLeadSponsorsRouteSchema,
  sponsorLeadConfirmationRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-sponsor-leads";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../_lib/services/events";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { listSponsorLeads, listLeadSponsors } from "../../../../_lib/services/event-participation/lead-list";
import { sponsorLeadContext } from "./sponsor-authorization";
import { readSponsorLeadConfirmationForRequest } from "../../../../_lib/services/event-participation/lead-confirmation";

export const SponsorLeadsGet = openApiRoute(sponsorLeadsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await sponsorLeadContext(c, data.params.eventSlug, data.params.sponsorId);
  return json(await listSponsorLeads(db, event.id, data.params.sponsorId, actor.id, data.query));
});
export const SponsorLeadSponsorsGet = openApiRoute(sponsorLeadSponsorsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(await listLeadSponsors(db, event.id, actor.id, data.query));
});
export const SponsorLeadConfirmationGet = openApiRoute(
  sponsorLeadConfirmationRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    return json(
      await readSponsorLeadConfirmationForRequest(
        requestDb(c),
        c.req.raw,
        c.env,
        data.params.eventSlug,
        data.params.sponsorId,
        data.params.operationId,
      ),
    );
  },
);
import { sponsorLeadCapturesRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-sponsor-leads";
import { listSponsorLeadCaptures } from "../../../../_lib/services/event-participation/lead-list";
export const SponsorLeadCapturesGet = openApiRoute(sponsorLeadCapturesRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await sponsorLeadContext(c, data.params.eventSlug, data.params.sponsorId);
  return json(
    await listSponsorLeadCaptures(db, event.id, data.params.sponsorId, data.params.leadId, actor.id, data.query),
  );
});
