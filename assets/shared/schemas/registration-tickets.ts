/**
 * Transport contracts for the ticket a registration holds: what it says, and
 * the routes that read, pay, refund, check and settle it.
 */
import { z } from "zod";
import { eventSlugParamsSchema, successResponseSchema, trimmedString, utcInstantSchema } from "./api-common";
import {
  registrationTicketStatusSchema,
  ticketAmountSchema,
  ticketAssignmentSourceSchema,
  ticketKeySchema,
  ticketMemberAuth,
  ticketOrganizerAuth,
  ticketRouteJson,
  ticketRouteRefusals,
  totalAmountSchema,
} from "./event-tickets";
import { databaseIdSchema } from "./identifiers";
import { stripeCurrencySchema } from "./stripe";

export const registrationTicketSchema = z.object({
  id: databaseIdSchema,
  ticketKey: ticketKeySchema,
  ticketName: z.string(),
  source: ticketAssignmentSourceSchema,
  status: registrationTicketStatusSchema,
  /** A total over the days attended, so it follows the quote's total, not one price. */
  amount: totalAmountSchema,
  currency: stripeCurrencySchema,
  codeLabel: z.string().nullable(),
  paidAt: utcInstantSchema.nullable(),
  disputed: z.boolean(),
  /** Why the person holds another ticket than the one decided for their organization, while that is open. */
  disputeReason: z.string().nullable(),
  /** A refund that the payment provider has neither confirmed nor refused yet, or whose failure is still being checked. */
  refundPending: z.boolean(),
  /** The latest refund for this ticket did not go through. */
  refundFailed: z.boolean(),
  /** The payment was made by a method that takes days and has not arrived yet; nothing is asked meanwhile. */
  paymentProcessing: z.boolean().default(false),
  /** The payment provider's reference for the payment, once paid. */
  paymentReference: z.string().nullable(),
  /** How it was paid and what arrived after the provider's costs, once read from the provider. */
  paymentMethod: z.string().nullable().default(null),
  netAmount: z.number().int().nullable().default(null),
  receiptUrl: z.url().nullable().default(null),
  /** Until when an unpaid ticket keeps its place; null when it has no deadline or nothing to pay. */
  payBy: utcInstantSchema.nullable().default(null),
  /** Until when this ticket is refunded on cancellation or a move to cheaper days; null when it never is. */
  refundableUntil: utcInstantSchema.nullable().default(null),
  /** The administration fee kept from such a refund. */
  refundFee: ticketAmountSchema.default(0),
  /** The event lets a ticket go to another person; organizers arrange it. */
  transferable: z.boolean().default(false),
  refundedAmount: totalAmountSchema,
  /** What was paid for the ticket; more than `amount` after a move to days that cost less. */
  paidAmount: totalAmountSchema.default(0),
});
export type RegistrationTicket = z.infer<typeof registrationTicketSchema>;

export const registrationTicketResponseSchema = z.object({ ticket: registrationTicketSchema.nullable() });
export const registrationTicketCheckoutResponseSchema = z.object({ checkoutUrl: z.url() });

export const registrationTicketRefundSchema = z.object({
  reason: trimmedString(3, 500, "Say why the ticket is refunded."),
});
/** Whether reading the payment provider changed what the ticket says. */
export const registrationTicketSyncResponseSchema = z.object({ success: z.literal(true), changed: z.boolean() });
export const registrationTicketReviewSchema = z.object({
  /** Keep the ticket the person chose, or move them to the ticket decided for their organization. */
  decision: z.enum(["keep", "move"]),
});

const registrationParams = eventSlugParamsSchema.extend({ registrationId: databaseIdSchema });

export const registrationTicketGetRouteSchema = {
  tags: ["Events"],
  summary: "Get a registration's ticket",
  request: { params: registrationParams },
  responses: {
    "200": { description: "The ticket.", content: ticketRouteJson(registrationTicketResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketMemberAuth,
};
export const registrationTicketCheckoutRouteSchema = {
  tags: ["Events"],
  summary: "Open payment for a registration's ticket",
  request: { params: registrationParams },
  responses: {
    "200": { description: "Where to pay.", content: ticketRouteJson(registrationTicketCheckoutResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketMemberAuth,
};
export const registrationTicketRefundRouteSchema = {
  tags: ["Events"],
  summary: "Refund a registration's ticket",
  request: {
    params: registrationParams,
    body: { required: true, content: ticketRouteJson(registrationTicketRefundSchema) },
  },
  responses: {
    "200": { description: "Refund requested.", content: ticketRouteJson(successResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const registrationTicketSyncRouteSchema = {
  tags: ["Events"],
  summary: "Bring a registration's ticket in line with the payment provider",
  request: { params: registrationParams },
  responses: {
    "200": { description: "The ticket was checked.", content: ticketRouteJson(registrationTicketSyncResponseSchema) },
    ...ticketRouteRefusals,
  },
  // The registrant asks whether their own payment arrived; an organizer of the event brings the whole ticket in line.
  ...ticketMemberAuth,
};
export const registrationTicketReviewRouteSchema = {
  tags: ["Events"],
  summary: "Settle a disputed ticket",
  request: {
    params: registrationParams,
    body: { required: true, content: ticketRouteJson(registrationTicketReviewSchema) },
  },
  responses: {
    "200": { description: "Dispute settled.", content: ticketRouteJson(successResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
