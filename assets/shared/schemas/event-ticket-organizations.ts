/**
 * Transport contracts for the ticket each organization gets: the decisions
 * that count for an event's tickets, a test of the classifier that stores
 * nothing, and an organizer's own decision.
 */
import { z } from "zod";
import {
  eventSlugParamsSchema,
  jsonErrorResponse,
  successResponseSchema,
  trimmedString,
  utcInstantSchema,
} from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { ticketKeySchema, ticketOrganizerAuth, ticketRouteJson, ticketRouteRefusals } from "./event-tickets";

/** Who decided an organization's ticket: an organizer, or the classifier when it was sure enough. */
export const TICKET_DECIDERS = ["organizer", "classifier"] as const;
export const ticketDeciderSchema = z.enum(TICKET_DECIDERS);
export type TicketDecider = z.infer<typeof ticketDeciderSchema>;

export const eventTicketOrganizationSchema = z.object({
  /** The decision that counts for this organization. */
  id: databaseIdSchema,
  /** As decisions are keyed: trimmed, single-spaced and in lower case. */
  organizationName: z.string(),
  /** Empty when the decision was made without a work address. */
  emailDomain: z.string(),
  ticketKey: ticketKeySchema,
  decidedBy: ticketDeciderSchema,
  /** How sure the classifier was; null for an organizer's decision. */
  confidencePercent: z.number().int().min(0).max(100).nullable(),
  updatedAt: utcInstantSchema,
});
export type EventTicketOrganization = z.infer<typeof eventTicketOrganizationSchema>;

export const eventTicketOrganizationListQuerySchema = listQuerySchema(["organization", "updated"] as const, {
  maxLimit: 100,
}).extend({ decidedBy: ticketDeciderSchema.optional() });
export type EventTicketOrganizationListQuery = z.infer<typeof eventTicketOrganizationListQuerySchema>;
export const eventTicketOrganizationListSchema = paginatedResponseSchema(
  "organizations",
  eventTicketOrganizationSchema,
);

/** The organization a test or a decision is about, as a person registering would give it. */
export const ticketOrganizationSubjectSchema = z.object({
  organizationName: trimmedString(2, 200, "Enter the organization's name."),
  /** A work address's domain. A personal mail domain is ignored, as it is at registration. */
  emailDomain: z.string().trim().max(253).optional(),
});

export const eventTicketOrganizationTrialSchema = ticketOrganizationSubjectSchema;
export type EventTicketOrganizationTrial = z.infer<typeof eventTicketOrganizationTrialSchema>;

export const eventTicketOrganizationTrialResponseSchema = z.object({
  /** The domain the classifier was given; null when none was given or it is a personal mail domain. */
  emailDomain: z.string().nullable(),
  /** Every described ticket, most likely first. */
  answers: z.array(
    z.object({
      ticketKey: ticketKeySchema,
      percent: z.number().int().min(0).max(100),
      thresholdPercent: z.number().int().min(0).max(100),
    }),
  ),
  /** The ticket this answer would decide; null when no ticket reaches its threshold. */
  decidedTicketKey: ticketKeySchema.nullable(),
  /** The decision that already counts for this organization, which a test never replaces. */
  current: eventTicketOrganizationSchema.pick({ ticketKey: true, decidedBy: true, confidencePercent: true }).nullable(),
});
export type EventTicketOrganizationTrialResponse = z.infer<typeof eventTicketOrganizationTrialResponseSchema>;

export const eventTicketOrganizationDecisionSchema = ticketOrganizationSubjectSchema.extend({
  ticketKey: ticketKeySchema,
});
export type EventTicketOrganizationDecision = z.infer<typeof eventTicketOrganizationDecisionSchema>;

export const eventTicketOrganizationDecisionParamsSchema = eventSlugParamsSchema.extend({
  decisionId: databaseIdSchema,
});

export const eventTicketOrganizationsGetRouteSchema = {
  tags: ["Events"],
  summary: "List the organizations whose ticket is decided",
  request: { params: eventSlugParamsSchema, query: eventTicketOrganizationListQuerySchema },
  responses: {
    "200": { description: "A page of organizations.", content: ticketRouteJson(eventTicketOrganizationListSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketOrganizationTrialRouteSchema = {
  tags: ["Events"],
  summary: "Test which ticket the classifier gives an organization",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketOrganizationTrialSchema) },
  },
  responses: {
    "200": {
      description: "The classifier's answer. Nothing is stored.",
      content: ticketRouteJson(eventTicketOrganizationTrialResponseSchema),
    },
    "429": jsonErrorResponse("Too many tests in a minute."),
    "503": jsonErrorResponse("The classifier did not answer."),
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketOrganizationDecisionPostRouteSchema = {
  tags: ["Events"],
  summary: "Decide an organization's ticket",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketOrganizationDecisionSchema) },
  },
  responses: {
    "200": { description: "Ticket decided.", content: ticketRouteJson(successResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketOrganizationDecisionDeleteRouteSchema = {
  tags: ["Events"],
  summary: "Clear an organization's ticket decision",
  request: { params: eventTicketOrganizationDecisionParamsSchema },
  responses: {
    "200": { description: "Decision cleared.", content: ticketRouteJson(successResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
