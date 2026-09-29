import {
  groupFormSubmissionCreateRouteSchema,
  groupFormSubmissionResponseSchema,
  groupFormSubmissionsListRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-forms";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { listGroupFormResponses, submitGroupFormResponse } from "../../../../../../_lib/services/forms";
import { requireGroupResourceContext } from "../../../group-resource-context";

export const GroupFormSubmissionCreate = openApiRoute(
  groupFormSubmissionCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const submissionId = await submitGroupFormResponse(db, viewer, group.id, data.params.placementId, data.body);
    return json(groupFormSubmissionResponseSchema.parse({ success: true, submissionId }), 201);
  },
);

export const GroupFormSubmissionsList = openApiRoute(
  groupFormSubmissionsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    if (!viewer.admin) {
      throw new AppError(403, "GROUP_FORM_RESPONSES_REQUIRED", "A staff identity with response access is required");
    }
    return json(await listGroupFormResponses(db, viewer.admin, group.id, data.params.placementId, data.query));
  },
);
