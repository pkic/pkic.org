/**
 * GET   /api/v1/sponsors/:id — detail
 * PATCH /api/v1/sponsors/:id — update tier/assigned staff/renewal
 *                                         date/notes (see stage.ts for
 *                                         pipeline stage advancement)
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { AppError } from "../../../../_lib/errors";
import {
  authorizedSponsorshipMutationDb,
  getSponsorship,
  toApiSponsorship,
  updateSponsorship,
} from "../../../../_lib/services/sponsorship";
import {
  sponsorshipGetRouteSchema,
  sponsorshipUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const SponsorGet = openApiRoute(sponsorshipGetRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "sponsorships:read");

  const sponsorship = await getSponsorship(db, data.params.id);
  if (!sponsorship) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }
  return json({ sponsorship: toApiSponsorship(sponsorship) });
});

export const SponsorUpdate = openApiRoute(sponsorshipUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");

  const body = data.body;
  const id = data.params.id;
  const sponsorship = await updateSponsorship(authorizedSponsorshipMutationDb(db, staff), staff.id, id, body);

  return json({ sponsorship: toApiSponsorship(sponsorship) });
});
