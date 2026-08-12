/**
 * PATCH /api/v1/me/organization-visibility.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../_lib/validation";
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { updateOrganizationVisibility } from "../../../_lib/services/member-self-service";
import {
  myOrganizationVisibilityUpdateRouteSchema,
  myOrganizationVisibilityUpdateSchema,
} from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, myOrganizationVisibilityUpdateSchema);
  await updateOrganizationVisibility(db, member, body.showOnOrgProfile);
  return json({ success: true, showOnOrgProfile: body.showOnOrgProfile });
}

export class MeOrganizationVisibilityPatch extends OpenAPIRoute {
  schema = myOrganizationVisibilityUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
