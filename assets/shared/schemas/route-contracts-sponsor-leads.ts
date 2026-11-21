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
  ...requiresSession(),
  tags: ["Events"],
  summary: "View own captured contacts or all current sponsor leads as a designated contact",
  request: { params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema }), query: sponsorLeadQuerySchema },
  responses: {
    ...ok("Live sponsor contacts with attributed capture time", sponsorLeadListSchema),
    ...authErrors({ notFound: "Active sponsorship not found", badRequest: "Invalid page query" }),
  },
};
export const sponsorLeadSponsorsRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Discover active sponsorships with lead access",
  request: { params: eventSlugParamsSchema, query: sponsorLeadSponsorsQuerySchema },
  responses: {
    ...ok("Sponsor-specific permissions", sponsorLeadSponsorsSchema),
    ...authErrors({ notFound: "Event not found", badRequest: "Invalid page query" }),
  },
};
import {
  sponsorLeadCapturesQuerySchema,
  sponsorLeadCapturesSchema,
  sponsorLeadConfirmationSchema,
} from "./event-sponsor-lead-list";
export const sponsorLeadCapturesRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "View own or designated sponsor contact's successful capture history",
  request: {
    params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema, leadId: databaseIdSchema }),
    query: sponsorLeadCapturesQuerySchema,
  },
  responses: {
    ...ok("Successful capture provenance without attendance implications", sponsorLeadCapturesSchema),
    ...authErrors({ notFound: "Current consenting lead not found", badRequest: "Invalid page query" }),
  },
};
export const sponsorLeadConfirmationRouteSchema = {
  ...requiresPermissions("agenda:leads_capture"),
  tags: ["Events"],
  summary: "Confirm one already captured sponsor lead for its scanner operator",
  request: { params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema, operationId: databaseIdSchema }) },
  responses: {
    ...ok("Current attendee identity after successful lead capture", sponsorLeadConfirmationSchema),
    ...authErrors({ notFound: "Captured lead not found" }),
  },
};
