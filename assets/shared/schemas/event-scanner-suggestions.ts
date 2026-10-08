import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema, eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { scannerTargetSchema } from "./event-participation-scanning";
import { requiresAnyPermissions } from "./route-contract";
import { timeZoneSchema } from "./event-series";
export const scannerSuggestionSchema = z
  .object({
    shiftId: databaseIdSchema,
    shiftName: z.string(),
    roles: z.array(z.string()).max(10),
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
    status: z.enum(["current", "upcoming"]),
    occurrence: scannerTargetSchema.extend({ startAt: utcInstantSchema, endAt: utcInstantSchema }),
    suggestedRoomId: databaseIdSchema.nullable(),
  })
  .strict();
export const scannerSuggestionsResponseSchema = z
  .object({
    serverTime: utcInstantSchema,
    timeZone: timeZoneSchema,
    publishedRevision: z.number().int().nonnegative().nullable(),
    suggestions: z.array(scannerSuggestionSchema).max(20),
    truncated: z.boolean(),
  })
  .strict();
export type ScannerSuggestion = z.infer<typeof scannerSuggestionSchema>;
export type ScannerSuggestionsResponse = z.infer<typeof scannerSuggestionsResponseSchema>;
export const scannerSuggestionsRouteSchema = {
  ...requiresAnyPermissions(["agenda:scan"], ["agenda:check"], ["agenda:admit"], ["agenda:attendance_record"]),
  tags: ["Events"],
  summary: "Suggest approved sessions for the operator's current and upcoming duties",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Own approved duty suggestions",
      content: { "application/json": { schema: scannerSuggestionsResponseSchema } },
    },
    "401": jsonErrorResponse("Sign in required"),
    "403": jsonErrorResponse("Event scanning permission required"),
    "409": jsonErrorResponse("The published agenda changed; refresh suggestions"),
  },
};
