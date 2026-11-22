import { sessionPopularityReportRouteSchema } from "../../../../../../assets/shared/schemas/event-session-popularity-report";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonNoStore } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { readSessionPopularityReport } from "../../../../../_lib/services/live-session/popularity-report";

/** An agenda reader compares how each session's audience reacted, asked and answered. */
export const SessionPopularityReportGet = openApiRoute(
  sessionPopularityReportRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    return jsonNoStore(
      await readSessionPopularityReport(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.query),
    );
  },
);
