import { registrationBadgeResponseSchema } from "../../../../../../../../assets/shared/schemas/participant-roles";
import {
  adminRegistrationBadgeRoleGetRouteSchema,
  adminRegistrationBadgeRolePatchRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import {
  getRegistrationBadge,
  setRegistrationBadge,
} from "../../../../../../../_lib/services/registrations/badge-role";
import type { ValidatedData } from "chanfana";

type GetData = ValidatedData<typeof adminRegistrationBadgeRoleGetRouteSchema>;

async function handleGet(c: AdminContext, data: GetData): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    registrationBadgeResponseSchema.parse(
      await getRegistrationBadge(requestDb(c), actor, data.params.eventSlug, data.params.registrationId),
    ),
  );
}

async function handlePatch(
  c: AdminContext,
  data: ValidatedData<typeof adminRegistrationBadgeRolePatchRouteSchema>,
): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const result = await setRegistrationBadge(requestDb(c), actor, {
    eventSlug: data.params.eventSlug,
    registrationId: data.params.registrationId,
    patch: data.body,
  });
  return json(registrationBadgeResponseSchema.parse(result.response));
}

export const AdminRegistrationBadgeRoleGet = openApiRoute(adminRegistrationBadgeRoleGetRouteSchema, handleGet);
export const AdminRegistrationBadgeRolePatch = openApiRoute(adminRegistrationBadgeRolePatchRouteSchema, handlePatch);
