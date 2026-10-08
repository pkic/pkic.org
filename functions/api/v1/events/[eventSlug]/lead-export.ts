import { sponsorLeadsExportRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-sponsor-leads";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { csvResponse } from "../../../../_lib/csv";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { exportSponsorLeads } from "../../../../_lib/services/event-participation/lead-export";
import { requireSponsorLeadPermission } from "./sponsor-authorization";

export const SponsorLeadsExportGet = openApiRoute(sponsorLeadsExportRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireSponsorLeadPermission(
    c,
    data.params.eventSlug,
    data.params.sponsorId,
    "agenda:leads_export",
  );
  return csvResponse(
    await exportSponsorLeads(db, event.id, data.params.sponsorId, actor.id),
    `leads-${data.params.eventSlug}-${data.params.sponsorId}.csv`,
  );
});
