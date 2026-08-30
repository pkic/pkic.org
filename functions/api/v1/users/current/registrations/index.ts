import { currentUserRegistrationsListResponseSchema } from "../../../../../../assets/shared/schemas/current-user-registrations";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserRegistrationsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-registrations";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listCurrentUserRegistrations } from "../../../../../_lib/services/registrations/current-user-read-model";

export const CurrentUserRegistrationsGet = openApiRoute(
  currentUserRegistrationsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const result = await listCurrentUserRegistrations(db, identity.userId, data.query);
    return json(
      currentUserRegistrationsListResponseSchema.parse({
        registrations: result.registrations,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.registrations.length),
      }),
    );
  },
);
