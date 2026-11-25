/**
 * Transport contracts for event tickets: the organizer's configuration, the
 * offer and quote a registrant sees. The ticket a registration holds is in
 * `registration-tickets.ts`.
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
import { sponsorTypeSchema } from "./sponsorship-management";
import { stripeCurrencySchema } from "./stripe";
import {
  DEFAULT_CLASSIFIER_THRESHOLD,
  DEFAULT_PAYMENT_RETRY_DAYS,
  REGISTRATION_TICKET_STATUSES,
  TICKET_ASSIGNMENT_SOURCES,
  TICKET_PRICE_CHARGED,
} from "../event-tickets";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.")
  // The pattern alone accepts February 30; a real date survives the round trip unchanged.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a date.");
/** One price, as an organizer enters it. */
export const ticketAmountSchema = z.number().int("Enter a whole amount.").min(0, "Enter 0 or more.").max(100_000_00);
/** What prices add up to over the days of an event: a line, a total, or what a ticket costs. */
export const totalAmountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
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
  classifierThresholdPercent: z
    .number()
    .int()
    .min(50, "Enter 50 or more.")
    .max(100, "Enter 100 or less.")
    .default(Math.round(DEFAULT_CLASSIFIER_THRESHOLD * 100)),
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
  underReview: z.number().int(),
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
  amounts: z.record(z.string(), ticketAmountSchema),
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
  /** How many days an unpaid place is kept before its registration is canceled; null keeps it until someone cancels. */
  unpaidHoldDays: z.number().int().min(1, "Enter 1 or more.").max(365, "Enter 365 or less.").nullable().default(null),
  /** How many days a place is kept after its payment failed, so the person can pay again. */
  /** Whether a ticket may go to another person. It says so to ticket holders; organizers arrange the transfer. */
  transferable: z.boolean().default(false),
  paymentRetryDays: z
    .number()
    .int()
    .min(1, "Enter 1 or more.")
    .max(365, "Enter 365 or less.")
    .default(DEFAULT_PAYMENT_RETRY_DAYS),
  /** The payment provider issues an invoice for each paid ticket, besides its receipt. */
  sendInvoice: z.boolean().default(true),
  /**
   * The refund policy. Null: no refunds. A number: a person who cancels or moves to days that cost less
   * gets the money back until that many days before the event starts.
   */
  refundDaysBeforeEvent: z
    .number()
    .int("Enter a whole number of days.")
    .min(0, "Enter 0 or more.")
    .max(365, "Enter 365 or less.")
    .nullable()
    .default(null),
  /** An administration fee kept from each refund the policy gives. An organizer's own refund returns everything. */
  refundFee: ticketAmountSchema.default(0),
});
const stepTextSchema = z.string().trim().max(400, "Use 400 characters or fewer.");
/** What registrants read above the tickets and above the days; empty shows nothing. */
export const eventTicketStepTextsSchema = z.object({ ticketIntro: stepTextSchema, attendanceIntro: stepTextSchema });
export const eventTicketGuidanceUpdateSchema = eventTicketStepTextsSchema.extend({ expectedRevision: revisionSchema });
export type EventTicketGuidanceUpdate = z.infer<typeof eventTicketGuidanceUpdateSchema>;
export const eventTicketSettingsUpdateSchema = eventTicketSettingsSchema
  .extend({ expectedRevision: revisionSchema })
  .superRefine((value, context) => {
    if (value.refundFee > 0 && value.refundDaysBeforeEvent === null)
      context.addIssue({
        code: "custom",
        path: ["refundDaysBeforeEvent"],
        message: "Enter until when refunds are given.",
      });
  });
export type EventTicketSettingsUpdate = z.infer<typeof eventTicketSettingsUpdateSchema>;

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
        /** Whether the catalog lists the tier for consortium or for event sponsors; null for a tier it does not list. */
        sponsorType: sponsorTypeSchema.nullable().default(null),
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
    underReviewCount: z.number().int(),
    underReviewAmount: z.number().int(),
    awaitingAmount: z.number().int(),
    awaitingCount: z.number().int(),
    freeCount: z.number().int(),
  }),
});
export type EventTicketsConfiguration = z.infer<typeof eventTicketsConfigurationSchema>;

export const eventTicketsChangeResponseSchema = successResponseSchema.extend({ revision: revisionSchema });

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
  /** A paid ticket is followed by an invoice from the payment provider; never for an individual registration. */
  sendInvoice: z.boolean().default(false),
  /** Until when a paid ticket is refunded on cancellation or a move to cheaper days; null when it never is. */
  refundableUntil: utcInstantSchema.nullable().default(null),
  /** The administration fee kept from such a refund. */
  refundFee: ticketAmountSchema.default(0),
  /** The event lets a ticket go to another person; organizers arrange it. */
  transferable: z.boolean().default(false),
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
      personalEmailAmount: ticketAmountSchema.nullable().default(null),
      /** Whether the person may hold it without a code: chosen freely, or by disputing the decision. */
      selectable: z.boolean(),
      prices: z.array(
        z.object({
          attendanceValue: z.string(),
          dayDate: calendarDateSchema.nullable(),
          charged: ticketPriceChargedSchema,
          amount: ticketAmountSchema,
          nextAmount: ticketAmountSchema.nullable(),
          /** What this price costs a personal address while it is free for a work address. */
          personalEmailAmount: ticketAmountSchema.nullable().default(null),
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

export const ticketRouteJson = <Schema extends z.ZodType>(schema: Schema) => ({ "application/json": { schema } });
export const ticketOrganizerAuth = { "x-pkic-auth": { required: true, scopes: ["events:write"] } } as const;
export const ticketReaderAuth = { "x-pkic-auth": { required: true, scopes: ["events:read"] } } as const;
export const ticketMemberAuth = { "x-pkic-auth": { required: true } } as const;
export const ticketRouteRefusals = {
  "400": jsonErrorResponse("Invalid ticket request."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("The required event permission is missing."),
  "404": jsonErrorResponse("Event, ticket, or registration not found."),
  "409": jsonErrorResponse("The tickets changed; reload before saving."),
};

export const eventTicketsGetRouteSchema = {
  tags: ["Events"],
  summary: "Get an event's tickets and prices",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": { description: "Ticket configuration.", content: ticketRouteJson(eventTicketsConfigurationSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketReaderAuth,
};
export const eventTicketTypeCreateRouteSchema = {
  tags: ["Events"],
  summary: "Add a ticket",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketTypeInputSchema) },
  },
  responses: {
    "200": { description: "Ticket added.", content: ticketRouteJson(eventTicketsChangeResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketTypeUpdateRouteSchema = {
  tags: ["Events"],
  summary: "Change a ticket",
  request: {
    params: eventTicketTypeParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketTypeInputSchema) },
  },
  responses: {
    "200": { description: "Ticket changed.", content: ticketRouteJson(eventTicketsChangeResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketPricesPutRouteSchema = {
  tags: ["Events"],
  summary: "Replace an event's ticket prices",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketPricesReplaceSchema) },
  },
  responses: {
    "200": { description: "Prices replaced.", content: ticketRouteJson(eventTicketsChangeResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketGuidancePutRouteSchema = {
  tags: ["Events"],
  summary: "Change what registrants read above the tickets and the days",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketGuidanceUpdateSchema) },
  },
  responses: {
    "200": { description: "Guidance changed.", content: ticketRouteJson(eventTicketsChangeResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketSettingsPutRouteSchema = {
  tags: ["Events"],
  summary: "Change an event's payment settings",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketSettingsUpdateSchema) },
  },
  responses: {
    "200": { description: "Settings changed.", content: ticketRouteJson(eventTicketsChangeResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketSponsorPassesPutRouteSchema = {
  tags: ["Events"],
  summary: "Set how many passes each sponsor tier gets",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketSponsorPassesUpdateSchema) },
  },
  responses: {
    "200": { description: "Passes saved.", content: ticketRouteJson(eventTicketsChangeResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketSponsorCodesPostRouteSchema = {
  tags: ["Events"],
  summary: "Create or top up the pass codes of the event's active sponsors",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": { description: "Codes created or raised.", content: ticketRouteJson(eventTicketSponsorCodesResponseSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketOrganizerAuth,
};
export const eventTicketOfferRouteSchema = {
  tags: ["Events"],
  summary: "Get the tickets offered to the person registering",
  request: { params: eventSlugParamsSchema, query: z.object({ identityId: databaseIdSchema.optional() }) },
  responses: {
    "200": { description: "The person's ticket offer.", content: ticketRouteJson(eventTicketOfferSchema) },
    ...ticketRouteRefusals,
  },
  "x-pkic-auth": { required: false },
};
export const eventTicketQuoteRouteSchema = {
  tags: ["Events"],
  summary: "Price the signed-in person's attendance choices",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: ticketRouteJson(eventTicketQuoteRequestSchema) },
  },
  responses: {
    "200": { description: "The price.", content: ticketRouteJson(eventTicketQuoteSchema) },
    ...ticketRouteRefusals,
  },
  ...ticketMemberAuth,
};
