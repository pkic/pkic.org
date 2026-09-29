import { groupFormSubmissionStatsRouteSchema } from "../../../../../../../assets/shared/schemas/group-forms";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getGroupFormResponseStatistics } from "../../../../../../_lib/services/forms";
import { requireGroupResourceContext } from "../../../group-resource-context";

export const GroupFormSubmissionStats = openApiRoute(
  groupFormSubmissionStatsRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    if (!viewer.admin) {
      throw new AppError(403, "GROUP_FORM_RESPONSES_REQUIRED", "A staff identity with response access is required");
    }
    return json(await getGroupFormResponseStatistics(db, viewer.admin, group.id, data.params.placementId, data.query));
  },
);
