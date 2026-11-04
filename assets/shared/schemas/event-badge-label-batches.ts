import { z } from "zod";
import { badgeCredentialSchema } from "./badge-credential";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { requiresPermissions } from "./route-contract";
import { badgePrintResponseSchema } from "./route-contracts-event-badges";

export const BADGE_LABEL_BATCH_SIZE = 1000;
export const badgeLabelBatchRequestSchema = z
  .object({
    operationId: databaseIdSchema,
    registrationIds: z
      .array(databaseIdSchema)
      .min(1)
      .max(BADGE_LABEL_BATCH_SIZE)
      .refine((ids) => new Set(ids).size === ids.length, "Select each registration once."),
  })
  .strict();
export type BadgeLabelBatchRequest = z.infer<typeof badgeLabelBatchRequestSchema>;
/** Compact authorized data. QR artwork is composed locally, never stored or rendered as a PDF. */
export const badgeLabelBatchItemSchema = badgePrintResponseSchema
  .omit({ svg: true, printingRevision: true })
  .extend({
    registrationId: databaseIdSchema,
    userId: databaseIdSchema,
    credential: badgeCredentialSchema,
  })
  .strict();
export const badgeLabelBatchResponseSchema = z
  .object({
    operationId: databaseIdSchema,
    labels: z.array(badgeLabelBatchItemSchema).min(1).max(BADGE_LABEL_BATCH_SIZE),
  })
  .strict();
export type BadgeLabelBatchResponse = z.infer<typeof badgeLabelBatchResponseSchema>;
export const badgeLabelBatchRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Events"],
  summary: "Read up to 1000 live attendee labels together, reusing or issuing their badge codes",
  request: {
    params: eventSlugParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: badgeLabelBatchRequestSchema },
      },
    },
  },
  responses: {
    "200": {
      description: "Transient attendee label data",
      content: { "application/json": { schema: badgeLabelBatchResponseSchema } },
    },
    "403": jsonErrorResponse("Event management permission required or changed"),
    "409": jsonErrorResponse("Selected registrations, credentials or printing access changed"),
    "503": jsonErrorResponse("Badge print encryption unavailable"),
  },
};
