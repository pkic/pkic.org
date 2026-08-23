import { adminBadgeRoleResponseSchema } from "../../../../../../../../assets/shared/schemas/participant-roles";
import {
  adminRegistrationBadgeRoleGetRouteSchema,
  adminRegistrationBadgeRolePatchRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import {
  getAdminRegistrationBadgeRole,
  setAdminRegistrationBadgeRole,
} from "../../../../../../../_lib/services/registrations/badge-role";
import type { ValidatedData } from "chanfana";

type GetData = ValidatedData<typeof adminRegistrationBadgeRoleGetRouteSchema>;

export async function onRequestGet(c: AdminContext, data?: GetData): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const params = data?.params ?? c.req.param();
  return json(
    adminBadgeRoleResponseSchema.parse(
      await getAdminRegistrationBadgeRole(requestDb(c), actor, params.eventSlug, params.registrationId),
    ),
  );
}

async function handlePatch(
  c: AdminContext,
  data: ValidatedData<typeof adminRegistrationBadgeRolePatchRouteSchema>,
): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const result = await setAdminRegistrationBadgeRole(requestDb(c), actor, {
    eventSlug: data.params.eventSlug,
    registrationId: data.params.registrationId,
    patch: data.body,
  });
  return json(adminBadgeRoleResponseSchema.parse(result.response));
}

export const AdminRegistrationBadgeRoleGet = openApiRoute(adminRegistrationBadgeRoleGetRouteSchema, onRequestGet);
export const AdminRegistrationBadgeRolePatch = openApiRoute(adminRegistrationBadgeRolePatchRouteSchema, handlePatch);
