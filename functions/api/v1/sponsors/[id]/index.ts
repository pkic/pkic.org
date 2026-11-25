/**
 * GET   /api/v1/sponsors/:id — detail
 * PATCH /api/v1/sponsors/:id — correct the record: tier, assigned staff,
 *                                         renewal date, notes, the point of
 *                                         contact, and a non-member sponsor's
 *                                         own name and website (see stage.ts
 *                                         for pipeline stage movement)
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import {
  authorizedSponsorshipMutationDb,
  loadAuthorizedSponsorship,
  requireSponsorshipActor,
  requireStaffToAssignSponsorship,
  toApiSponsorship,
  updateSponsorship,
} from "../../../../_lib/services/sponsorship";
import {
  sponsorshipGetRouteSchema,
  sponsorshipUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../_lib/db/context";

export const SponsorGet = openApiRoute(sponsorshipGetRouteSchema, async (c: AdminContext, data) => {
  const { db, actor } = await requireSponsorshipActor(c);
  const { sponsorship } = await loadAuthorizedSponsorship(db, actor, data.params.id, "read");
  return json({ sponsorship: toApiSponsorship(sponsorship) });
});

export const SponsorUpdate = openApiRoute(sponsorshipUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, actor: staff } = await requireSponsorshipActor(c);

  const body = data.body;
  const id = data.params.id;
  const { access } = await loadAuthorizedSponsorship(db, staff, id, "write");
  requireStaffToAssignSponsorship(access, body.assignedToUserId);
  const sponsorship = await updateSponsorship(authorizedSponsorshipMutationDb(db, staff, access), staff.id, id, body);

  return json({ sponsorship: toApiSponsorship(sponsorship) });
});
