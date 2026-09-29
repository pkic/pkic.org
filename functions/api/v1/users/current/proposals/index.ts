import { currentUserProposalsListResponseSchema } from "../../../../../../assets/shared/schemas/current-user-proposals";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserProposalsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-proposals";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listCurrentUserProposals } from "../../../../../_lib/services/proposal-current-user-read-model";

export const CurrentUserProposalsGet = openApiRoute(
  currentUserProposalsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const result = await listCurrentUserProposals(db, identity.userId, data.query);
    return json(
      currentUserProposalsListResponseSchema.parse({
        proposals: result.proposals,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.proposals.length),
      }),
    );
  },
);
