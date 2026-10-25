import { registrationIdentityChangeRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-registration-participant";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { changeRegistrationIdentity } from "../../../../_lib/services/registrations/change-identity";

export const RegistrationIdentityPut = openApiRoute(
  registrationIdentityChangeRouteSchema,
  async (c: AdminContext, data) =>
    json(await changeRegistrationIdentity(requestDb(c), c.req.raw, c.env, data.params.registrationId, data.body)),
  markResponseSensitive,
);
