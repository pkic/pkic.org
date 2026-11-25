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
import {
  eventTicketTypeInputSchema,
  ticketKeySchema,
  ticketOrganizerAuth,
  ticketRouteJson,
  ticketRouteRefusals,
} from "./event-tickets";

/** Who decided an organization's ticket: an organizer, or the classifier when it was sure enough. */
export const TICKET_DECIDERS = ["organizer", "classifier"] as const;
export const ticketDeciderSchema = z.enum(TICKET_DECIDERS);
export type TicketDecider = z.infer<typeof ticketDeciderSchema>;

/** Which organizations the list is about: those with a decision, or every organization in the portal. */
export const TICKET_ORGANIZATION_SCOPES = ["decided", "portal"] as const;
export const ticketOrganizationScopeSchema = z.enum(TICKET_ORGANIZATION_SCOPES);
export type TicketOrganizationScope = z.infer<typeof ticketOrganizationScopeSchema>;

export const eventTicketOrganizationSchema = z.object({
  /** The decision that counts for this organization; null when nothing has decided it. */
  id: databaseIdSchema.nullable(),
  organizationId: databaseIdSchema,
  organizationName: z.string(),
  /** Every domain the organization is recognized by; the classifier reads them all. */
  domains: z.array(z.string()),
  ticketKey: ticketKeySchema.nullable(),
  decidedBy: ticketDeciderSchema.nullable(),
  /** How sure the classifier was; null for an organizer's decision or no decision. */
  confidencePercent: z.number().int().min(0).max(100).nullable(),
  updatedAt: utcInstantSchema.nullable(),
});
export type EventTicketOrganization = z.infer<typeof eventTicketOrganizationSchema>;

export const eventTicketOrganizationListQuerySchema = listQuerySchema(["organization", "updated"] as const, {
  maxLimit: 100,
}).extend({
  among: ticketOrganizationScopeSchema.default("decided"),
  decidedBy: ticketDeciderSchema.optional(),
  ticketKey: ticketKeySchema.optional(),
});
export type EventTicketOrganizationListQuery = z.infer<typeof eventTicketOrganizationListQuerySchema>;
export const eventTicketOrganizationListSchema = paginatedResponseSchema(
  "organizations",
  eventTicketOrganizationSchema,
);

export const TICKET_SUBJECT_MAX_DOMAINS = 10;

/** A portal organization, tested by its own name and domains. */
export const ticketPortalOrganizationSubjectSchema = z.object({ organizationId: databaseIdSchema });

/** An organization as an organizer types it, to see how the classifier treats it. It is tested, never saved. */
export const ticketTypedOrganizationSubjectSchema = z.object({
  organizationName: trimmedString(2, 200, "Enter the organization's name."),
  /** Work domains. A personal mail domain is ignored, as it is at registration. */
  domains: z
    .array(z.string().trim().min(1).max(253))
    .max(TICKET_SUBJECT_MAX_DOMAINS, `Enter up to ${String(TICKET_SUBJECT_MAX_DOMAINS)} domains.`)
    .default([]),
});

export const ticketOrganizationSubjectSchema = z.union([
  ticketPortalOrganizationSubjectSchema,
  ticketTypedOrganizationSubjectSchema,
]);
export type TicketOrganizationSubject = z.infer<typeof ticketOrganizationSubjectSchema>;

/**
 * A ticket's "who gets this ticket" as an organizer is still editing it. The test reads it in place of the saved
 * ticket with the same id, or beside the saved tickets when the ticket is not added yet.
 */
export const eventTicketClassifierDraftSchema = eventTicketTypeInputSchema
  .pick({ key: true, classifierDescription: true, classifierThresholdPercent: true, active: true })
  .extend({ ticketTypeId: databaseIdSchema.nullable() });
export type EventTicketClassifierDraft = z.infer<typeof eventTicketClassifierDraftSchema>;

export const TICKET_TRIAL_MAX_ORGANIZATIONS = 25;
export const eventTicketOrganizationTrialSchema = z.object({
  organizations: z.array(ticketOrganizationSubjectSchema).min(1).max(TICKET_TRIAL_MAX_ORGANIZATIONS),
  draft: eventTicketClassifierDraftSchema.optional(),
});
export type EventTicketOrganizationTrial = z.infer<typeof eventTicketOrganizationTrialSchema>;

export const eventTicketOrganizationTrialResultSchema = z.object({
  /** The portal organization tested; null for a typed one. */
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string(),
  /** The domains the classifier was given: personal mail domains are left out. */
  domains: z.array(z.string()),
  /** Every described ticket, most likely first; null when the classifier did not answer. */
  answers: z
    .array(
      z.object({
        ticketKey: ticketKeySchema,
        percent: z.number().int().min(0).max(100),
        thresholdPercent: z.number().int().min(0).max(100),
      }),
    )
    .nullable(),
  /** The ticket this answer would decide; null when no ticket reaches its threshold or there is no answer. */
  decidedTicketKey: ticketKeySchema.nullable(),
  /** The decision that already counts for this organization, which a test never replaces. */
  current: eventTicketOrganizationSchema.pick({ ticketKey: true, decidedBy: true, confidencePercent: true }).nullable(),
  /** Set when the classifier did not answer for this organization, or the organization is no longer in the portal. */
  error: z.enum(["unavailable", "not_found"]).nullable(),
});
export type EventTicketOrganizationTrialResult = z.infer<typeof eventTicketOrganizationTrialResultSchema>;

export const eventTicketOrganizationTrialResponseSchema = z.object({
  /** In the order the organizations were given. */
  results: z.array(eventTicketOrganizationTrialResultSchema),
});
export type EventTicketOrganizationTrialResponse = z.infer<typeof eventTicketOrganizationTrialResponseSchema>;

export const eventTicketOrganizationDecisionSchema = ticketPortalOrganizationSubjectSchema.extend({
  ticketKey: z.string({ error: "Choose a ticket." }).pipe(ticketKeySchema),
});
export type EventTicketOrganizationDecision = z.infer<typeof eventTicketOrganizationDecisionSchema>;

export const TICKET_DECISIONS_MAX = 100;
/** Decisions saved together: all or none. */
export const eventTicketOrganizationDecisionsSchema = z.object({
  decisions: z.array(eventTicketOrganizationDecisionSchema).min(1).max(TICKET_DECISIONS_MAX),
});
export type EventTicketOrganizationDecisions = z.infer<typeof eventTicketOrganizationDecisionsSchema>;

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
  summary: "Test which ticket the classifier gives each organization",
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
  summary: "Decide the ticket of one or more organizations",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketOrganizationDecisionsSchema) },
  },
  responses: {
    "200": { description: "Tickets decided.", content: ticketRouteJson(successResponseSchema) },
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
