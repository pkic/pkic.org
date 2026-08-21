/**
 * GET /api/v1/sponsor-portal/events/:eventId/attendees — "Sponsor
 * Portal — Attendee Data Access". Magic-link session scoped to a single
 * sponsorships.id; eligibility is re-checked live on every request (see
 * _lib/auth/sponsor-portal.ts's requireSponsorPortalFromRequest — it
 * already enforces "sponsorship must still be active"), plus the
 * event-in-URL-matches-session-event and tier-qualifies-for-attendee-access
 * checks below.
 */
import { json } from "../../../../../../_lib/http";
import { requireSponsorPortalFromRequest } from "../../../../../../_lib/auth/sponsor-portal";
import {
  listSponsorPortalAttendeesPage,
  requireSponsorPortalAttendeeAccess,
} from "../../../../../../_lib/services/sponsorship";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { sponsorPortalAttendeesListRouteSchema } from "../../../../../../../assets/shared/schemas/sponsor-portal";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

// Exported for reuse by the sibling CSV export endpoint (./export.ts) —
// keeps re-deriving eventId from the request itself (not from this route's
// validated data) since it's shared across two independently-schema'd routes.
export async function requireEligibleSponsorPortalSession(c: AdminContext) {
  const db = requestDb(c);
  const session = await requireSponsorPortalFromRequest(db, c.req.raw, c.env);
  const eventId = c.req.param("eventId");
  await requireSponsorPortalAttendeeAccess(db, session, eventId);
  return { db, session };
}

export const SponsorPortalAttendeesList = openApiRoute(
  sponsorPortalAttendeesListRouteSchema,
  async (c: AdminContext, data) => {
    const { db, session } = await requireEligibleSponsorPortalSession(c);
    const { limit = 100, offset = 0, q, sort } = data.query;
    const { attendees, total } = await listSponsorPortalAttendeesPage(db, session.eventId, {
      limit,
      offset,
      q,
      sort,
    });

    await writeAuditLog(
      db,
      "sponsor",
      session.sponsorshipId,
      "sponsor_portal_attendee_list_viewed",
      "sponsorship",
      session.sponsorshipId,
      {
        recordCount: attendees.length,
      },
    );

    return json({ attendees, page: buildPageInfo(limit, offset, total, attendees.length) });
  },
);
