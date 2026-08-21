/**
 * GET   /api/v1/admin/sponsorships/:id — detail
 * PATCH /api/v1/admin/sponsorships/:id — update tier/assigned staff/renewal
 *                                         date/notes (see stage.ts for
 *                                         pipeline stage advancement)
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import {
  getAdminSponsorship,
  toApiSponsorship,
  updateAdminSponsorship,
} from "../../../../../_lib/services/sponsorship";
import {
  sponsorshipGetRouteSchema,
  sponsorshipUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const SponsorshipGet = openApiRoute(sponsorshipGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:read");

  const sponsorship = await getAdminSponsorship(db, data.params.id);
  if (!sponsorship) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }
  return json({ sponsorship: toApiSponsorship(sponsorship) });
});

export const SponsorshipUpdate = openApiRoute(sponsorshipUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const body = data.body;
  const id = data.params.id;
  const sponsorship = await updateAdminSponsorship(db, admin.id, id, body);

  return json({ sponsorship: toApiSponsorship(sponsorship) });
});
