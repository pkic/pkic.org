import { adminBadgeRolePatchSchema } from "../../../../../../../../assets/shared/schemas/participant-roles";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../../../../../_lib/http";
import {
  getAdminRegistrationBadgeRole,
  setAdminRegistrationBadgeRole,
} from "../../../../../../../_lib/services/registrations/badge-role";
import { parseJsonBody } from "../../../../../../../_lib/validation";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    await getAdminRegistrationBadgeRole(requestDb(c), actor, c.req.param("eventSlug"), c.req.param("registrationId")),
  );
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const patch = await parseJsonBody(c.req, adminBadgeRolePatchSchema);
  const result = await setAdminRegistrationBadgeRole(requestDb(c), actor, {
    eventSlug: c.req.param("eventSlug"),
    registrationId: c.req.param("registrationId"),
    patch,
  });
  return json(result.response);
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet, PATCH: onRequestPatch });
}
