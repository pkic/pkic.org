import { userMeetingParticipationListRouteSchema } from "../../../../../../assets/shared/schemas/user-participation-history";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listUserMeetingParticipation } from "../../../../../_lib/services/user-participation-history/meetings";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireUserStaffPermission } from "../../authorization";

export const UserParticipationMeetingsGet = openApiRoute(
  userMeetingParticipationListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireUserStaffPermission(c, "users:read");
    return jsonPrivate(await listUserMeetingParticipation(db, data.params.userId, data.query));
  },
);
