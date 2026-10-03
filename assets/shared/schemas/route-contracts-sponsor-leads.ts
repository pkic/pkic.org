import { requiresPermissions } from "./route-contract";
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";

export const sponsorLeadsExportRouteSchema = {
  ...requiresPermissions("agenda:leads_export"),
  tags: ["Events"],
  summary: "Export consenting attendees captured by one sponsor",
  request: { params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema }) },
  responses: {
    "200": { description: "Sponsor leads CSV", content: { "text/csv": { schema: z.string() } } },
    "403": jsonErrorResponse("Sponsor lead export permission required"),
    "404": jsonErrorResponse("Active event sponsorship not found"),
  },
};
