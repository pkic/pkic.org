import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { getEventBySlug } from "../../../../_lib/services/events";
export async function requireSponsorLeadPermission(
  c: AdminContext,
  eventSlug: string,
  sponsorshipId: string,
  permission = "agenda:leads_capture",
) {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, eventSlug);
  const context = { type: "event_sponsor", id: sponsorshipId };
  requirePermission(actor, permission, context);
  return { db, actor, event, context };
}
