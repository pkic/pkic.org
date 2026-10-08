import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema, eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { requiresSession } from "./route-contract";
export const sessionHoldRequestSchema = z
  .object({
    userId: databaseIdSchema,
    roomId: databaseIdSchema.nullable().optional(),
    attendanceMode: z.enum(["physical", "remote"]),
    expiresAt: utcInstantSchema,
    reasonCode: z.enum(["speaker", "staff", "organizer_invitation"]),
  })
  .strict();
export const sessionHoldResponseSchema = z.object({ id: databaseIdSchema, expiresAt: utcInstantSchema }).strict();
export const sessionHoldRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Reserve an explicit expiring organizer hold",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: sessionHoldRequestSchema } } },
  },
  responses: {
    "200": { description: "Counted hold", content: { "application/json": { schema: sessionHoldResponseSchema } } },
    "409": jsonErrorResponse("Capacity or expiry conflict"),
  },
};
export const sessionHoldListSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: databaseIdSchema,
          userId: databaseIdSchema,
          attendanceMode: sessionHoldRequestSchema.shape.attendanceMode,
          expiresAt: utcInstantSchema,
          reasonCode: sessionHoldRequestSchema.shape.reasonCode,
          createdAt: utcInstantSchema,
        })
        .strict(),
    ),
  })
  .strict();
export const sessionHoldRevokeSchema = z
  .object({ revoked: z.boolean(), promoted: z.number().int().nonnegative() })
  .strict();
export const sessionHoldsGetRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "List active organizer holds",
  request: { params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }) },
  responses: {
    "200": { description: "Active holds", content: { "application/json": { schema: sessionHoldListSchema } } },
  },
};
export const sessionHoldDeleteRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Release an organizer hold",
  request: { params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema, holdId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Hold released and waitlist reconsidered",
      content: { "application/json": { schema: sessionHoldRevokeSchema } },
    },
  },
};
