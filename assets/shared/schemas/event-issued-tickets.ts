/**
 * Transport contracts for the tickets an event has issued: the organizer's
 * list of who holds which ticket and how it was paid, its totals, and the
 * request that brings a batch of them in line with the payment provider.
 */
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { registrationTicketSchema } from "./registration-tickets";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { stripeCurrencySchema } from "./stripe";

/** Where a ticket's payment stands, as an organizer filters by it. */
export const ISSUED_TICKET_PAYMENT_STATES = [
  "paid",
  "payment_under_review",
  "processing",
  "to_pay",
  "free",
  "refunded",
  "canceled",
] as const;
export const issuedTicketPaymentStateSchema = z.enum(ISSUED_TICKET_PAYMENT_STATES);
export type IssuedTicketPaymentState = z.infer<typeof issuedTicketPaymentStateSchema>;

export const issuedTicketSchema = z.object({
  registrationId: databaseIdSchema,
  /** The holder, as their registration presents them. */
  name: z.string(),
  organizationName: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  payment: issuedTicketPaymentStateSchema,
  issuedAt: z.string(),
  ticket: registrationTicketSchema,
});
export type IssuedTicket = z.infer<typeof issuedTicketSchema>;

export const issuedTicketsQuerySchema = listQuerySchema(["name", "amount", "paid", "issued"] as const, {
  maxLimit: 100,
}).extend({ payment: issuedTicketPaymentStateSchema.optional() });
export type IssuedTicketsQuery = z.infer<typeof issuedTicketsQuerySchema>;

const count = z.number().int().nonnegative();

export const issuedTicketsSummarySchema = z.object({
  currency: stripeCurrencySchema,
  byPayment: z.partialRecord(issuedTicketPaymentStateSchema, count),
  /** What was paid and not returned. */
  collected: z.number().int(),
  underReviewAmount: z.number().int(),
  /** What the payment provider kept of it, for the payments read so far. */
  providerFees: z.number().int(),
  refunded: z.number().int(),
  refundedCount: count,
  awaitingAmount: z.number().int(),
  /** Payments whose method and costs the provider has not been read for yet. */
  unread: count,
  /** Tickets an update from the payment provider could change: unread payments and open payment pages. */
  updatable: count,
});
export type IssuedTicketsSummary = z.infer<typeof issuedTicketsSummarySchema>;

export const issuedTicketsResponseSchema = paginatedResponseSchema("tickets", issuedTicketSchema).extend({
  summary: issuedTicketsSummarySchema,
});
export type IssuedTicketsResponse = z.infer<typeof issuedTicketsResponseSchema>;

/** One bounded batch; `after` continues where the previous batch ended. */
export const issuedTicketsUpdateRequestSchema = z.object({ after: databaseIdSchema.optional() }).strict();
export const issuedTicketsUpdateResponseSchema = z.object({
  success: z.literal(true),
  checked: count,
  changed: count,
  failed: count,
  /** The ticket to continue after; null when every ticket was checked. */
  next: databaseIdSchema.nullable(),
});
export type IssuedTicketsUpdateResponse = z.infer<typeof issuedTicketsUpdateResponseSchema>;

const json = <Schema extends z.ZodType>(schema: Schema) => ({ "application/json": { schema } });
const refusals = {
  "400": jsonErrorResponse("Invalid ticket request."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("The required event permission is missing."),
  "404": jsonErrorResponse("Event not found."),
};

export const issuedTicketsGetRouteSchema = {
  tags: ["Events"],
  summary: "List the tickets an event has issued, with their payments",
  request: { params: eventSlugParamsSchema, query: issuedTicketsQuerySchema },
  responses: {
    "200": { description: "A page of tickets and the totals.", content: json(issuedTicketsResponseSchema) },
    ...refusals,
  },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};
export const issuedTicketsUpdateRouteSchema = {
  tags: ["Events"],
  summary: "Bring a batch of an event's tickets in line with the payment provider",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: json(issuedTicketsUpdateRequestSchema) },
  },
  responses: {
    "200": { description: "The batch was checked.", content: json(issuedTicketsUpdateResponseSchema) },
    ...refusals,
  },
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};
