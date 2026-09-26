import { currentUserDonationsListResponseSchema } from "../../../../../../assets/shared/schemas/current-user-donations";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserDonationsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-donations";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listCurrentUserDonations } from "../../../../../_lib/services/donations/current-user-read-model";

export const CurrentUserDonationsGet = openApiRoute(
  currentUserDonationsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const result = await listCurrentUserDonations(db, identity.userId, data.query);
    return json(
      currentUserDonationsListResponseSchema.parse({
        donations: result.donations,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.donations.length),
      }),
    );
  },
);
