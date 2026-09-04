import { userVoteParticipationListRouteSchema } from "../../../../../../assets/shared/schemas/user-participation-history";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listUserVoteParticipation } from "../../../../../_lib/services/user-participation-history/votes";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireUserStaffPermission } from "../../authorization";

export const UserParticipationVotesGet = openApiRoute(
  userVoteParticipationListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireUserStaffPermission(c, "users:read");
    return jsonPrivate(await listUserVoteParticipation(db, data.params.userId, data.query));
  },
);
