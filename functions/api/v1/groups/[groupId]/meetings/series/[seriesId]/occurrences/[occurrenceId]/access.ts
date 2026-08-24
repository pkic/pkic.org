import {
  eventOccurrenceAccessIssueRouteSchema,
  meetingAccessTokenResponseSchema,
} from "../../../../../../../../../../assets/shared/schemas/event-series";
import { requireAdminFromRequest } from "../../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { issueOccurrenceAccessToken } from "../../../../../../../../../_lib/services/event-series";

export const GroupMeetingAccessIssue = openApiRoute(
  eventOccurrenceAccessIssueRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const access = await issueOccurrenceAccessToken(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.body,
    );
    return json(meetingAccessTokenResponseSchema.parse({ access }), 201);
  },
);
