import { livePollResultsRouteSchema } from "../../../../../../assets/shared/schemas/live-session-poll-results";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listLivePollResults } from "../../../../../_lib/services/live-session/poll-results";
import { requireEventPermission } from "../authorization";

/** A room operator reads a session's poll results from the durable copy. */
export const LivePollResultsGet = openApiRoute(livePollResultsRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
  return json(await listLivePollResults(db, event.id, data.params.occurrenceId, data.query));
});
