import { z } from "zod";
import { requiresPermissions, authErrors } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  sessionDemandReportQuerySchema,
  sessionDemandReportExportQuerySchema,
  sessionDemandReportResponseSchema,
} from "./event-session-demand-report";
const common = {
  ...requiresPermissions("agenda:read"),
  tags: ["Events"],
};
export const sessionDemandReportRouteSchema = {
  ...common,
  summary: "Report published session favorites, bookings and separate capacity occupancy",
  request: { params: eventSlugParamsSchema, query: sessionDemandReportQuerySchema },
  responses: {
    "200": {
      description: "Bounded published agenda demand report",
      content: { "application/json": { schema: sessionDemandReportResponseSchema } },
    },
    ...authErrors({
      forbidden: "Agenda reading permission required",
      notFound: "Event unavailable",
      conflict: "Published agenda changed; refresh the report",
    }),
    "422": jsonErrorResponse("Calendar day cannot be resolved in the published agenda timezone"),
  },
};
export const sessionDemandReportExportRouteSchema = {
  ...common,
  summary: "Export every filtered published session demand row within documented limits",
  request: { params: eventSlugParamsSchema, query: sessionDemandReportExportQuerySchema },
  responses: {
    "200": {
      description: "Complete filtered CSV, at most 10000 rows and 20 MiB",
      content: { "text/csv": { schema: z.string() } },
    },
    ...authErrors({
      forbidden: "Agenda reading permission required",
      notFound: "Event unavailable",
      conflict: "Published agenda changed; refresh the export",
    }),
    "413": jsonErrorResponse("Narrow the export filters to fit the row and byte limits"),
    "422": jsonErrorResponse("Calendar day cannot be resolved in the published agenda timezone"),
  },
};
