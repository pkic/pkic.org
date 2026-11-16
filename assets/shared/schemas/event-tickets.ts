/**
 * Transport contracts for event tickets: the organizer's configuration, the
 * offer and quote a registrant sees, and the ticket a registration holds.
 * Amounts are integers in the currency's smallest unit.
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
import { stripeCurrencySchema } from "./stripe";
import { REGISTRATION_TICKET_STATUSES, TICKET_ASSIGNMENT_SOURCES, TICKET_PRICE_CHARGED } from "../event-tickets";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.")
  // The pattern alone accepts February 30; a real date survives the round trip unchanged.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a date.");
/** One price, as an organizer enters it. */
const amountSchema = z.number().int("Enter a whole amount.").min(0, "Enter 0 or more.").max(100_000_00);
/** What prices add up to over the days of an event: a line, a total, or what a ticket costs. */
const totalAmountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const revisionSchema = z.number().int().min(0);

export const ticketKeySchema = z
  .string()
  .trim()
  .min(2, "Enter a key of at least 2 characters.")
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, digits and underscores, starting with a letter.");

export const ticketPriceChargedSchema = z.enum(TICKET_PRICE_CHARGED);
export const registrationTicketStatusSchema = z.enum(REGISTRATION_TICKET_STATUSES);
export const ticketAssignmentSourceSchema = z.enum(TICKET_ASSIGNMENT_SOURCES);

// ── Organizer configuration ─────────────────────────────────────────────────

export const eventTicketTypeInputSchema = z.object({
  expectedRevision: revisionSchema,
  key: ticketKeySchema,
  name: trimmedString(1, 80, "Enter a name."),
  descriptionMarkdown: z.string().trim().max(2000).default(""),
  /** Who qualifies, as the classifier is asked. Empty keeps the ticket out of automatic assignment. */
  classifierDescription: z.string().trim().max(4000).default(""),
  classifierThresholdPercent: z.number().int().min(50, "Enter 50 or more.").max(100, "Enter 100 or less.").default(85),
  isDefault: z.boolean().default(false),
  freeRequiresWorkEmail: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type EventTicketTypeInput = z.infer<typeof eventTicketTypeInputSchema>;

export const eventTicketTypeSchema = z.object({
  id: databaseIdSchema,
  key: ticketKeySchema,
  name: z.string(),
  descriptionMarkdown: z.string(),
  classifierDescription: z.string(),
  classifierThresholdPercent: z.number().int(),
  isDefault: z.boolean(),
  freeRequiresWorkEmail: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  registered: z.number().int(),
  paid: z.number().int(),
  awaitingPayment: z.number().int(),
  presetOrganizations: z.number().int(),
});
export type EventTicketType = z.infer<typeof eventTicketTypeSchema>;

export const eventTicketPricePeriodSchema = z.object({
  id: z.string().min(1).max(64),
  startsOn: calendarDateSchema.nullable(),
});
export type EventTicketPricePeriod = z.infer<typeof eventTicketPricePeriodSchema>;

export const eventTicketPriceSchema = z.object({
  id: z.string().min(1).max(64),
  ticketTypeId: databaseIdSchema,
  attendanceValue: z.string().trim().min(1).max(64),
  dayDate: calendarDateSchema.nullable(),
  charged: ticketPriceChargedSchema,
  /** Amount by period id. */
  amounts: z.record(z.string(), amountSchema),
});
export type EventTicketPrice = z.infer<typeof eventTicketPriceSchema>;

/** Replaces every period and price of the event in one command. Ids of new rows are the caller's own references. */
export const eventTicketPricesReplaceSchema = z
  .object({
    expectedRevision: revisionSchema,
    periods: z.array(eventTicketPricePeriodSchema).min(1).max(12),
    prices: z.array(eventTicketPriceSchema).max(120),
  })
  .superRefine((value, context) => {
    if (value.periods.filter((period) => period.startsOn === null).length !== 1)
      context.addIssue({ code: "custom", path: ["periods"], message: "Keep exactly one opening price." });
    const dates = new Set<string>();
    value.periods.forEach((period, index) => {
      if (period.startsOn === null) return;
      if (dates.has(period.startsOn))
        context.addIssue({ code: "custom", path: ["periods", index, "startsOn"], message: "Use each date once." });
      dates.add(period.startsOn);
    });
    const rows = new Set<string>();
    value.prices.forEach((price, index) => {
      const key = `${price.ticketTypeId}|${price.attendanceValue}|${price.dayDate ?? ""}`;
      if (rows.has(key))
        context.addIssue({
          code: "custom",
          path: ["prices", index, "attendanceValue"],
          message: "This price is listed twice.",
        });
      rows.add(key);
    });
  });
export type EventTicketPricesReplaceInput = z.infer<typeof eventTicketPricesReplaceSchema>;

export const eventTicketSettingsSchema = z.object({
  currency: stripeCurrencySchema,
  reminderIntervalDays: z.number().int().min(1, "Enter 1 or more.").max(30, "Enter 30 or less."),
  reminderPeriodDays: z.number().int().min(0, "Enter 0 or more.").max(365, "Enter 365 or less."),
  /** The payment provider issues an invoice for each paid ticket, besides its receipt. */
  sendInvoice: z.boolean().default(true),
});
const stepTextSchema = z.string().trim().max(400, "Use 400 characters or fewer.");
/** What registrants read above the tickets and above the days; empty shows nothing. */
export const eventTicketStepTextsSchema = z.object({ ticketIntro: stepTextSchema, attendanceIntro: stepTextSchema });
/** A text left out of an update keeps its saved value. */
export const eventTicketSettingsUpdateSchema = eventTicketSettingsSchema
  .extend(eventTicketStepTextsSchema.partial().shape)
  .extend({ expectedRevision: revisionSchema });
export type EventTicketSettingsUpdate = z.infer<typeof eventTicketSettingsUpdateSchema>;

export const eventTicketCodeSchema = z.object({
  id: databaseIdSchema,
  ticketTypeId: databaseIdSchema,
  label: z.string(),
  code: z.string(),
  amount: amountSchema.nullable(),
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
    amount: amountSchema.optional(),
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
export const eventTicketTypeParamsSchema = eventSlugParamsSchema.extend({ ticketTypeId: databaseIdSchema });

const passCountSchema = z.number().int().min(0, "Enter 0 or more.").max(1000, "Enter 1,000 or less.");

/** How many passes a sponsor of each tier gets, and which tickets those passes give. */
export const eventTicketSponsorPassesSchema = z.object({
  staffTicketTypeId: databaseIdSchema.nullable(),
  customerTicketTypeId: databaseIdSchema.nullable(),
  tiers: z
    .array(
      z.object({
        tierName: trimmedString(1, 80),
        staffPasses: passCountSchema,
        customerPasses: passCountSchema,
        /** Active sponsors of this tier, and how many of them have their codes. */
        sponsors: z.number().int().default(0),
        sponsorsWithCodes: z.number().int().default(0),
      }),
    )
    .max(40),
});
export const eventTicketSponsorPassesUpdateSchema = eventTicketSponsorPassesSchema
  .extend({ expectedRevision: revisionSchema })
  .superRefine((value, context) => {
    const gives = value.tiers.some((tier) => tier.staffPasses > 0 || tier.customerPasses > 0);
    if (gives && value.tiers.some((tier) => tier.staffPasses > 0) && !value.staffTicketTypeId)
      context.addIssue({
        code: "custom",
        path: ["staffTicketTypeId"],
        message: "Choose the ticket staff passes give.",
      });
    if (gives && value.tiers.some((tier) => tier.customerPasses > 0) && !value.customerTicketTypeId)
      context.addIssue({
        code: "custom",
        path: ["customerTicketTypeId"],
        message: "Choose the ticket customer passes give.",
      });
  });
export type EventTicketSponsorPassesUpdate = z.infer<typeof eventTicketSponsorPassesUpdateSchema>;
export const eventTicketSponsorCodesResponseSchema = successResponseSchema.extend({
  created: z.number().int(),
  raised: z.number().int(),
});

export const eventTicketsConfigurationSchema = z.object({
  revision: revisionSchema,
  timeZone: z.string(),
  settings: eventTicketSettingsSchema.extend(eventTicketStepTextsSchema.shape),
  currentPeriodId: z.string().nullable(),
  types: z.array(eventTicketTypeSchema),
  periods: z.array(eventTicketPricePeriodSchema),
  prices: z.array(eventTicketPriceSchema),
  sponsorPasses: eventTicketSponsorPassesSchema,
  attendanceOptions: z.array(z.object({ value: z.string(), label: z.string(), icon: z.string().nullable() })),
  days: z.array(z.object({ dayDate: calendarDateSchema, label: z.string().nullable() })),
  totals: z.object({
    collected: z.number().int(),
    paidCount: z.number().int(),
    awaitingAmount: z.number().int(),
    awaitingCount: z.number().int(),
    freeCount: z.number().int(),
  }),
});
export type EventTicketsConfiguration = z.infer<typeof eventTicketsConfigurationSchema>;

export const eventTicketsChangeResponseSchema = successResponseSchema.extend({ revision: revisionSchema });
export const eventTicketCodeCreateResponseSchema = successResponseSchema.extend({ code: eventTicketCodeSchema });

// ── Registrant: offer, quote, selection ─────────────────────────────────────

const dayAttendanceChoiceSchema = z.object({
  dayDate: calendarDateSchema,
  attendanceType: z.string().trim().min(1).max(64),
});

export const eventTicketOfferSchema = z.object({
  /** False when the event sells no tickets: registration is unchanged. */
  enabled: z.boolean(),
  currency: stripeCurrencySchema,
  timeZone: z.string(),
  /** The ticket already decided for this person, when one is. */
  assigned: z
    .object({
      ticketKey: ticketKeySchema,
      source: ticketAssignmentSourceSchema,
      organizationName: z.string().nullable(),
    })
    .nullable(),
  currentPeriodStartsOn: calendarDateSchema.nullable(),
  nextPeriodStartsOn: calendarDateSchema.nullable(),
  /** A paid ticket is followed by an invoice from the payment provider. */
  sendInvoice: z.boolean().default(false),
  ticketIntro: z.string().default(""),
  attendanceIntro: z.string().default(""),
  /** The person registers with a personal mailbox, so a ticket that is free only for work addresses costs them money. */
  personalEmail: z.boolean().default(false),
  tickets: z.array(
    z.object({
      key: ticketKeySchema,
      name: z.string(),
      descriptionMarkdown: z.string(),
      /** What this ticket costs a personal mailbox while it is free for work addresses; null when the rule does not apply. */
      personalEmailAmount: amountSchema.nullable().default(null),
      /** Whether the person may hold it without a code: chosen freely, or by disputing the decision. */
      selectable: z.boolean(),
      prices: z.array(
        z.object({
          attendanceValue: z.string(),
          dayDate: calendarDateSchema.nullable(),
          charged: ticketPriceChargedSchema,
          amount: amountSchema,
          nextAmount: amountSchema.nullable(),
          /** What this price costs a personal address while it is free for a work address. */
          personalEmailAmount: amountSchema.nullable().default(null),
        }),
      ),
    }),
  ),
});
export type EventTicketOffer = z.infer<typeof eventTicketOfferSchema>;

export const eventTicketQuoteRequestSchema = z.object({
  dayAttendance: z.array(dayAttendanceChoiceSchema).max(62),
  ticketKey: ticketKeySchema.optional(),
  code: z.string().trim().max(64).optional(),
  /** Why the decided ticket is wrong. Required to hold another ticket than the one decided. */
  disputeReason: z.string().trim().max(1000).optional(),
  /** The identity the person registers as; its address decides whether a work address is used. */
  identityId: databaseIdSchema.optional(),
  /** Keep this choice for the registration that follows. */
  save: z.boolean().default(false),
});
export type EventTicketQuoteRequest = z.infer<typeof eventTicketQuoteRequestSchema>;

export const eventTicketQuoteSchema = z.object({
  ticketKey: ticketKeySchema,
  ticketName: z.string(),
  source: ticketAssignmentSourceSchema,
  currency: stripeCurrencySchema,
  lines: z.array(
    z.object({
      attendanceValue: z.string(),
      dayDates: z.array(calendarDateSchema),
      charged: ticketPriceChargedSchema,
      amount: totalAmountSchema,
      /** A price for the event that a higher one the person also chose covers. */
      included: z.boolean(),
    }),
  ),
  subtotal: totalAmountSchema,
  total: totalAmountSchema,
  codeLabel: z.string().nullable(),
  /** The total the same choices cost from the next price change, when it differs. */
  nextTotal: totalAmountSchema.nullable(),
  nextPeriodStartsOn: calendarDateSchema.nullable(),
  /** A free ticket that needs a work email address is priced for this personal address. */
  personalEmailPrice: z.boolean(),
});
export type EventTicketQuote = z.infer<typeof eventTicketQuoteSchema>;

// ── The ticket on a registration ────────────────────────────────────────────

export const registrationTicketSchema = z.object({
  id: databaseIdSchema,
  ticketKey: ticketKeySchema,
  ticketName: z.string(),
  source: ticketAssignmentSourceSchema,
  status: registrationTicketStatusSchema,
  amount: amountSchema,
  currency: stripeCurrencySchema,
  codeLabel: z.string().nullable(),
  paidAt: utcInstantSchema.nullable(),
  disputed: z.boolean(),
  /** Why the person holds another ticket than the one decided for their organization, while that is open. */
  disputeReason: z.string().nullable(),
  /** A refund that the payment provider has neither confirmed nor refused yet. */
  refundPending: z.boolean(),
  /** The latest refund for this ticket did not go through. */
  refundFailed: z.boolean(),
  /** The payment provider's reference for the payment, once paid. */
  paymentReference: z.string().nullable(),
  refundedAmount: totalAmountSchema,
});
export type RegistrationTicket = z.infer<typeof registrationTicketSchema>;

export const registrationTicketResponseSchema = z.object({ ticket: registrationTicketSchema.nullable() });
export const registrationTicketCheckoutResponseSchema = z.object({ checkoutUrl: z.url() });

export const registrationTicketRefundSchema = z.object({
  reason: trimmedString(3, 500, "Say why the ticket is refunded."),
});
export const registrationTicketReviewSchema = z.object({
  /** Keep the ticket the person chose, or move them to the ticket decided for their organization. */
  decision: z.enum(["keep", "move"]),
});

const registrationParams = eventSlugParamsSchema.extend({ registrationId: databaseIdSchema });
const json = <Schema extends z.ZodType>(schema: Schema) => ({ "application/json": { schema } });
const organizer = { "x-pkic-auth": { required: true, scopes: ["events:write"] } } as const;
const reader = { "x-pkic-auth": { required: true, scopes: ["events:read"] } } as const;
const member = { "x-pkic-auth": { required: true } } as const;
const refusals = {
  "400": jsonErrorResponse("Invalid ticket request."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("The required event permission is missing."),
  "404": jsonErrorResponse("Event, ticket, or registration not found."),
  "409": jsonErrorResponse("The tickets changed; reload before saving."),
};

export const eventTicketCodesGetRouteSchema = {
  tags: ["Events"],
  summary: "List an event's ticket codes",
  request: { params: eventSlugParamsSchema, query: eventTicketCodeListQuerySchema },
  responses: {
    "200": { description: "A page of codes.", content: json(eventTicketCodeListSchema) },
    ...refusals,
  },
  ...reader,
};
export const eventTicketsGetRouteSchema = {
  tags: ["Events"],
  summary: "Get an event's tickets and prices",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": { description: "Ticket configuration.", content: json(eventTicketsConfigurationSchema) },
    ...refusals,
  },
  ...reader,
};
export const eventTicketTypeCreateRouteSchema = {
  tags: ["Events"],
  summary: "Add a ticket",
  request: { params: eventSlugParamsSchema, body: { required: true, content: json(eventTicketTypeInputSchema) } },
  responses: { "200": { description: "Ticket added.", content: json(eventTicketsChangeResponseSchema) }, ...refusals },
  ...organizer,
};
export const eventTicketTypeUpdateRouteSchema = {
  tags: ["Events"],
  summary: "Change a ticket",
  request: { params: eventTicketTypeParamsSchema, body: { required: true, content: json(eventTicketTypeInputSchema) } },
  responses: {
    "200": { description: "Ticket changed.", content: json(eventTicketsChangeResponseSchema) },
    ...refusals,
  },
  ...organizer,
};
export const eventTicketPricesPutRouteSchema = {
  tags: ["Events"],
  summary: "Replace an event's ticket prices",
  request: { params: eventSlugParamsSchema, body: { required: true, content: json(eventTicketPricesReplaceSchema) } },
  responses: {
    "200": { description: "Prices replaced.", content: json(eventTicketsChangeResponseSchema) },
    ...refusals,
  },
  ...organizer,
};
export const eventTicketSettingsPutRouteSchema = {
  tags: ["Events"],
  summary: "Change an event's payment settings",
  request: { params: eventSlugParamsSchema, body: { required: true, content: json(eventTicketSettingsUpdateSchema) } },
  responses: {
    "200": { description: "Settings changed.", content: json(eventTicketsChangeResponseSchema) },
    ...refusals,
  },
  ...organizer,
};
export const eventTicketCodeCreateRouteSchema = {
  tags: ["Events"],
  summary: "Create a ticket code",
  request: { params: eventSlugParamsSchema, body: { required: true, content: json(eventTicketCodeCreateSchema) } },
  responses: {
    "200": { description: "Code created.", content: json(eventTicketCodeCreateResponseSchema) },
    ...refusals,
  },
  ...organizer,
};
export const eventTicketCodeUpdateRouteSchema = {
  tags: ["Events"],
  summary: "Change a ticket code's limit or revoke it",
  request: {
    params: eventTicketCodeParamsSchema,
    body: { required: true, content: json(eventTicketCodeUpdateSchema) },
  },
  responses: { "200": { description: "Code changed.", content: json(successResponseSchema) }, ...refusals },
  ...organizer,
};
export const eventTicketSponsorPassesPutRouteSchema = {
  tags: ["Events"],
  summary: "Set how many passes each sponsor tier gets",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: json(eventTicketSponsorPassesUpdateSchema) },
  },
  responses: { "200": { description: "Passes saved.", content: json(eventTicketsChangeResponseSchema) }, ...refusals },
  ...organizer,
};
export const eventTicketSponsorCodesPostRouteSchema = {
  tags: ["Events"],
  summary: "Create or top up the pass codes of the event's active sponsors",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": { description: "Codes created or raised.", content: json(eventTicketSponsorCodesResponseSchema) },
    ...refusals,
  },
  ...organizer,
};
export const eventTicketOfferRouteSchema = {
  tags: ["Events"],
  summary: "Get the tickets offered to the person registering",
  request: { params: eventSlugParamsSchema, query: z.object({ identityId: databaseIdSchema.optional() }) },
  responses: {
    "200": { description: "The person's ticket offer.", content: json(eventTicketOfferSchema) },
    ...refusals,
  },
  "x-pkic-auth": { required: false },
};
export const eventTicketQuoteRouteSchema = {
  tags: ["Events"],
  summary: "Price the signed-in person's attendance choices",
  request: { params: eventSlugParamsSchema, body: { required: true, content: json(eventTicketQuoteRequestSchema) } },
  responses: { "200": { description: "The price.", content: json(eventTicketQuoteSchema) }, ...refusals },
  ...member,
};
export const registrationTicketGetRouteSchema = {
  tags: ["Events"],
  summary: "Get a registration's ticket",
  request: { params: registrationParams },
  responses: { "200": { description: "The ticket.", content: json(registrationTicketResponseSchema) }, ...refusals },
  ...member,
};
export const registrationTicketCheckoutRouteSchema = {
  tags: ["Events"],
  summary: "Open payment for a registration's ticket",
  request: { params: registrationParams },
  responses: {
    "200": { description: "Where to pay.", content: json(registrationTicketCheckoutResponseSchema) },
    ...refusals,
  },
  ...member,
};
export const registrationTicketRefundRouteSchema = {
  tags: ["Events"],
  summary: "Refund a registration's ticket",
  request: { params: registrationParams, body: { required: true, content: json(registrationTicketRefundSchema) } },
  responses: { "200": { description: "Refund requested.", content: json(successResponseSchema) }, ...refusals },
  ...organizer,
};
export const registrationTicketReviewRouteSchema = {
  tags: ["Events"],
  summary: "Settle a disputed ticket",
  request: { params: registrationParams, body: { required: true, content: json(registrationTicketReviewSchema) } },
  responses: { "200": { description: "Dispute settled.", content: json(successResponseSchema) }, ...refusals },
  ...organizer,
};
