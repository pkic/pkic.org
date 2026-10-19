import { requiresPermissions, requiresSession, ok, authErrors } from "./route-contract";
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

import {
  sponsorLeadQuerySchema,
  sponsorLeadListSchema,
  sponsorLeadSponsorsQuerySchema,
  sponsorLeadSponsorsSchema,
} from "./event-sponsor-lead-list";
export const sponsorLeadsRouteSchema = {
  ...requiresPermissions("agenda:leads_view"),
  tags: ["Events"],
  summary: "View current consenting contacts captured by one sponsor",
  request: { params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema }), query: sponsorLeadQuerySchema },
  responses: {
    ...ok("Live sponsor contacts with attributed capture time", sponsorLeadListSchema),
    ...authErrors({ notFound: "Active sponsorship not found", badRequest: "Invalid page query" }),
  },
};
export const sponsorLeadSponsorsRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Discover active sponsorships with explicit lead permissions",
  request: { params: eventSlugParamsSchema, query: sponsorLeadSponsorsQuerySchema },
  responses: {
    ...ok("Sponsor-specific permissions", sponsorLeadSponsorsSchema),
    ...authErrors({ notFound: "Event not found", badRequest: "Invalid page query" }),
  },
};
import { sponsorLeadCapturesQuerySchema, sponsorLeadCapturesSchema } from "./event-sponsor-lead-list";
export const sponsorLeadCapturesRouteSchema = {
  ...requiresPermissions("agenda:leads_view"),
  tags: ["Events"],
  summary: "View attributed successful capture history for one current consenting lead",
  request: {
    params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema, leadId: databaseIdSchema }),
    query: sponsorLeadCapturesQuerySchema,
  },
  responses: {
    ...ok("Successful capture provenance without attendance implications", sponsorLeadCapturesSchema),
    ...authErrors({ notFound: "Current consenting lead not found", badRequest: "Invalid page query" }),
  },
};
