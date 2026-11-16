/** Transport contracts for unfinished registrations: the person's own, and the organizer's summary. */
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse, successResponseSchema, utcInstantSchema } from "./api-common";
import { UNFINISHED_REGISTRATION_REASONS } from "../unfinished-registrations";

export const unfinishedRegistrationReasonSchema = z.enum(UNFINISHED_REGISTRATION_REASONS);

/** The signed-in person's own unfinished registration for the event. */
export const ownUnfinishedRegistrationSchema = z.object({
  eventName: z.string(),
  /** `none`: they never started. `stopped`: they said they will not register. */
  state: z.enum(["unfinished", "stopped", "registered", "none"]),
});
export type OwnUnfinishedRegistration = z.infer<typeof ownUnfinishedRegistrationSchema>;

/** The person says they will not register. Both the reason and the note are theirs to give. */
export const unfinishedRegistrationStopSchema = z.object({
  reasonCode: unfinishedRegistrationReasonSchema.optional(),
  reasonNote: z.string().trim().max(1000, "Use 1,000 characters or fewer.").optional(),
});
export type UnfinishedRegistrationStop = z.infer<typeof unfinishedRegistrationStopSchema>;

export const unfinishedRegistrationSummarySchema = z.object({
  /** Everyone who started, whether or not they finished. */
  started: z.number().int(),
  registered: z.number().int(),
  reminded: z.number().int(),
  stopped: z.number().int(),
  /** Of those who stopped, how many picked a reason. */
  gaveReason: z.number().int(),
  reasons: z.array(z.object({ reasonCode: unfinishedRegistrationReasonSchema.nullable(), count: z.number().int() })),
  /** The most recent notes people left. */
  notes: z.array(
    z.object({
      reasonCode: unfinishedRegistrationReasonSchema.nullable(),
      note: z.string(),
      stoppedAt: utcInstantSchema,
    }),
  ),
});
export type UnfinishedRegistrationSummary = z.infer<typeof unfinishedRegistrationSummarySchema>;

const json = <Schema extends z.ZodType>(schema: Schema) => ({ "application/json": { schema } });
const refusals = {
  "400": jsonErrorResponse("Invalid request."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("The required event permission is missing."),
  "404": jsonErrorResponse("Event or unfinished registration not found."),
};

export const unfinishedRegistrationStartRouteSchema = {
  tags: ["Events"],
  summary: "Record that the signed-in person started registering",
  request: { params: eventSlugParamsSchema },
  responses: { "200": { description: "Recorded once.", content: json(successResponseSchema) }, ...refusals },
  "x-pkic-auth": { required: true },
};
export const ownUnfinishedRegistrationGetRouteSchema = {
  tags: ["Events"],
  summary: "Get the signed-in person's unfinished registration",
  request: { params: eventSlugParamsSchema },
  responses: { "200": { description: "Its state.", content: json(ownUnfinishedRegistrationSchema) }, ...refusals },
  "x-pkic-auth": { required: true },
};
export const ownUnfinishedRegistrationStopRouteSchema = {
  tags: ["Events"],
  summary: "Say that the signed-in person will not register",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: json(unfinishedRegistrationStopSchema) },
  },
  responses: { "200": { description: "Recorded; reminders stop.", content: json(successResponseSchema) }, ...refusals },
  "x-pkic-auth": { required: true },
};
export const unfinishedRegistrationSummaryRouteSchema = {
  tags: ["Events"],
  summary: "Summarize unfinished registrations and why people stopped",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": { description: "The summary.", content: json(unfinishedRegistrationSummarySchema) },
    ...refusals,
  },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};
