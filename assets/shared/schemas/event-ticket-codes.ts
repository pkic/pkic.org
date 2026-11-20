/**
 * Transport contracts for an event's ticket codes: a code gives a ticket at
 * its own price or percentage off, to a limited number of people.
 */
import { z } from "zod";
import { eventSlugParamsSchema, successResponseSchema, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  ticketAmountSchema,
  ticketOrganizerAuth,
  ticketReaderAuth,
  ticketRouteJson,
  ticketRouteRefusals,
} from "./event-tickets";

export const eventTicketCodeSchema = z.object({
  id: databaseIdSchema,
  ticketTypeId: databaseIdSchema,
  label: z.string(),
  code: z.string(),
  amount: ticketAmountSchema.nullable(),
  percentOff: z.number().int().nullable(),
  maxUses: z.number().int(),
  usedCount: z.number().int(),
  revokedAt: utcInstantSchema.nullable(),
});
export type EventTicketCode = z.infer<typeof eventTicketCodeSchema>;

/** Codes are a collection of their own: an event can hold more than one screen of them. */
export const eventTicketCodeListQuerySchema = listQuerySchema(["label", "used", "created"] as const, {
  maxLimit: 100,
});
export type EventTicketCodeListQuery = z.infer<typeof eventTicketCodeListQuerySchema>;
export const eventTicketCodeListSchema = paginatedResponseSchema("codes", eventTicketCodeSchema);

export const eventTicketCodeCreateSchema = z
  .object({
    ticketTypeId: databaseIdSchema,
    label: trimmedString(2, 120, "Say who the code is for."),
    discount: z.enum(["amount", "percent"]),
    amount: ticketAmountSchema.optional(),
    percentOff: z.number().int().min(1, "Enter 1 or more.").max(100, "Enter 100 or less.").optional(),
    maxUses: z.number().int().min(1, "Enter 1 or more.").max(10_000, "Enter 10,000 or less."),
  })
  .superRefine((value, context) => {
    if (value.discount === "amount" && value.amount === undefined)
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter the price with this code. Enter 0 for free.",
      });
    if (value.discount === "percent" && value.percentOff === undefined)
      context.addIssue({ code: "custom", path: ["percentOff"], message: "Enter the percentage off." });
  });
export type EventTicketCodeCreate = z.infer<typeof eventTicketCodeCreateSchema>;

export const eventTicketCodeUpdateSchema = z.object({
  maxUses: z.number().int().min(1, "Enter 1 or more.").max(10_000, "Enter 10,000 or less.").optional(),
  /** Raises the limit by this many, whatever it is by now; two organizers adding uses both count. */
  addUses: z.number().int().min(1).max(1_000).optional(),
  revoked: z.boolean().optional(),
});
export const eventTicketCodeParamsSchema = eventSlugParamsSchema.extend({ codeId: databaseIdSchema });
export const eventTicketCodeCreateResponseSchema = successResponseSchema.extend({ code: eventTicketCodeSchema });

export const eventTicketCodesGetRouteSchema = {
  tags: ["Events"],
  summary: "List an event's ticket codes",
  request: { params: eventSlugParamsSchema, query: eventTicketCodeListQuerySchema },
  responses: {
    "200": { description: "A page of codes.", content: ticketRouteJson(eventTicketCodeListSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketReaderAuth,
};
export const eventTicketCodeCreateRouteSchema = {
  tags: ["Events"],
  summary: "Create a ticket code",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketCodeCreateSchema) },
  },
  responses: {
    "200": { description: "Code created.", content: ticketRouteJson(eventTicketCodeCreateResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketCodeUpdateRouteSchema = {
  tags: ["Events"],
  summary: "Change a ticket code's limit or revoke it",
  request: {
    params: eventTicketCodeParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketCodeUpdateSchema) },
  },
  responses: {
    "200": { description: "Code changed.", content: ticketRouteJson(successResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
