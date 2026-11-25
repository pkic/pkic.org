/**
 * Transport contracts for an event's ticket codes: a code gives a ticket at
 * its own price or percentage off, to a limited number of people.
 */
import { z } from "zod";
import { eventSlugParamsSchema, successResponseSchema, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { ticketAmountSchema, ticketOrganizerAuth, ticketRouteJson, ticketRouteRefusals } from "./event-tickets";
import { sponsorTypeSchema } from "./sponsorship-management";

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
  /** The sponsor the code was made for: what it brings in counts for that sponsor. */
  sponsor: z.object({ id: databaseIdSchema, name: z.string() }).nullable(),
  /** Tickets issued with the code, whatever became of them. */
  registrations: z.number().int(),
  /** What the code's paid tickets brought in, after refunds, in cents. */
  revenue: z.number().int(),
});
export type EventTicketCode = z.infer<typeof eventTicketCodeSchema>;

/** Codes are a collection of their own: an event can hold more than one screen of them. */
export const eventTicketCodeListQuerySchema = listQuerySchema(
  ["label", "used", "created", "registrations", "revenue"] as const,
  { maxLimit: 100 },
).extend({ sponsorId: databaseIdSchema.optional() });
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
    /** One of the event's sponsors; omit for a code that belongs to no sponsor. */
    sponsorId: databaseIdSchema.optional(),
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
  ...ticketOrganizerAuth,
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

/** A sponsor of the event a code can be made for: its own event sponsors and the consortium's current sponsors. */
export const eventTicketSponsorSchema = z.object({
  /** The member organization, or the sponsorship when no member organization is behind it. */
  id: databaseIdSchema,
  name: z.string(),
  tier: z.string(),
  sponsorType: sponsorTypeSchema,
});
export type EventTicketSponsor = z.infer<typeof eventTicketSponsorSchema>;
export const eventTicketSponsorListQuerySchema = listQuerySchema(["name"] as const, { maxLimit: 100 });
export const eventTicketSponsorListSchema = paginatedResponseSchema("sponsors", eventTicketSponsorSchema);

export const eventTicketSponsorsGetRouteSchema = {
  tags: ["Events"],
  summary: "List the sponsors a ticket code can be made for",
  request: { params: eventSlugParamsSchema, query: eventTicketSponsorListQuerySchema },
  responses: {
    "200": { description: "A page of sponsors.", content: ticketRouteJson(eventTicketSponsorListSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
