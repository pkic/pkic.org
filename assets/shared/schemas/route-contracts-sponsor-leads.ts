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
  sponsorLeadDetailSchema,
  sponsorLeadRemovalResponseSchema,
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
export const sponsorLeadDetailRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "View one currently consenting sponsor lead within the caller's scope",
  request: { params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema, leadId: databaseIdSchema }) },
  responses: {
    ...ok("Current sponsor lead", sponsorLeadDetailSchema),
    ...authErrors({ notFound: "Current consenting lead not found" }),
  },
};
const sponsorLeadRemovalParams = eventSlugParamsSchema.extend({
  sponsorId: databaseIdSchema,
  leadId: databaseIdSchema,
});
export const sponsorLeadOwnCapturesDeleteRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Withdraw this operator's captures of one sponsor lead",
  request: { params: sponsorLeadRemovalParams },
  responses: {
    ...ok("Own captures withdrawn and audited", sponsorLeadRemovalResponseSchema),
    ...authErrors({ notFound: "Active lead captures not found in this operator's scope" }),
  },
};
export const sponsorLeadDeleteRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Withdraw every capture of one lead for the sponsor contact",
  request: { params: sponsorLeadRemovalParams },
  responses: {
    ...ok("Sponsor lead withdrawn and audited", sponsorLeadRemovalResponseSchema),
    ...authErrors({ notFound: "Active sponsor lead captures not found" }),
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

import { sponsorLeadNoteRequestSchema, sponsorLeadNoteResponseSchema } from "./event-sponsor-lead-list";
export const sponsorLeadNotePutRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Replace the sponsor team's note about one lead within the caller's scope",
  request: {
    params: eventSlugParamsSchema.extend({ sponsorId: databaseIdSchema, leadId: databaseIdSchema }),
    body: { content: { "application/json": { schema: sponsorLeadNoteRequestSchema } }, required: true },
  },
  responses: {
    ...ok("Saved lead note", sponsorLeadNoteResponseSchema),
    ...authErrors({
      badRequest: "Invalid note",
      notFound: "Current consenting lead not found",
      conflict: "Lead changes are closed for this event",
    }),
  },
};
