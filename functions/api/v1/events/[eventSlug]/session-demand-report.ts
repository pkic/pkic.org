import {
  sessionDemandReportRouteSchema,
  sessionDemandReportExportRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-session-demand-report";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { markResponseSensitive } from "../../../../_lib/db/context";
import { csvResponse } from "../../../../_lib/csv";
import { jsonNoStore } from "../../../../_lib/http";
import {
  eventSessionDemandReport,
  exportSessionDemandReport,
} from "../../../../_lib/services/event-participation/session-demand-report";
import { requireEventPermission } from "./authorization";
export const SessionDemandReportGet = openApiRoute(sessionDemandReportRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:read");
  return jsonNoStore(await eventSessionDemandReport(db, event.id, actor, data.query));
});
export const SessionDemandReportExportGet = openApiRoute(sessionDemandReportExportRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:read");
  const result = await exportSessionDemandReport(db, event.id, actor, data.query);
  return csvResponse(result.csv, `${event.slug}-session-demand.csv`);
});
