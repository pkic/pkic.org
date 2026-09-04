import { userEventParticipationListRouteSchema } from "../../../../../../assets/shared/schemas/user-participation-history";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listUserEventParticipation } from "../../../../../_lib/services/user-participation-history/events";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireUserStaffPermission } from "../../authorization";

export const UserParticipationEventsGet = openApiRoute(
  userEventParticipationListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireUserStaffPermission(c, "users:read");
    return jsonPrivate(await listUserEventParticipation(db, data.params.userId, data.query));
  },
);
