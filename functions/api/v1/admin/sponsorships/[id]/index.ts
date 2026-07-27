/**
 * GET   /api/v1/admin/sponsorships/:id — detail
 * PATCH /api/v1/admin/sponsorships/:id — update tier/assigned staff/renewal
 *                                         date/notes (see stage.ts for
 *                                         pipeline stage advancement)
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  getAdminSponsorship,
  toApiSponsorship,
  updateAdminSponsorship,
} from "../../../../../_lib/services/sponsorship";
import {
  sponsorshipGetRouteSchema,
  sponsorshipUpdateSchema,
  sponsorshipUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:read");

  const sponsorship = await getAdminSponsorship(db, c.req.param("id"));
  if (!sponsorship) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }
  return json({ sponsorship: toApiSponsorship(sponsorship) });
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "sponsorships:write");

  const body = await parseJsonBody(c.req, sponsorshipUpdateSchema);
  const id = c.req.param("id");
  const sponsorship = await updateAdminSponsorship(db, id, body);

  await writeAuditLog(db, "admin", admin.id, "sponsorship_updated", "sponsorship", id, body);

  return json({ sponsorship: toApiSponsorship(sponsorship) });
}

export class SponsorshipGet extends OpenAPIRoute {
  schema = sponsorshipGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class SponsorshipUpdate extends OpenAPIRoute {
  schema = sponsorshipUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
