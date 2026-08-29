import { z } from "zod";
import { httpUrlSchema } from "./urls";
import { databaseIdSchema } from "./identifiers";
import { publicOperation } from "./route-contract";

export const sendgridEventSchema = z
  .object({
    event: z.string().trim().min(1).max(64),
    sg_message_id: z.string().trim().min(1).max(500).optional(),
    sg_event_id: z.string().trim().min(1).max(500).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    type: z.string().trim().max(64).optional(),
    reason: z.string().trim().max(4000).optional(),
    status: z.string().trim().max(100).optional(),
    response: z.string().trim().max(4000).optional(),
    timestamp: z.number().int().positive().optional(),
    asm_group_id: z.number().int().positive().optional(),
    env_url: httpUrlSchema.optional(),
    outbox_id: databaseIdSchema.optional(),
  })
  .passthrough();

export const sendgridEventBatchSchema = z.array(sendgridEventSchema).max(500);
export type SendgridEvent = z.infer<typeof sendgridEventSchema>;

export const sendgridWebhookPostRouteSchema = {
  ...publicOperation(),
  tags: ["Email"],
  summary: "Receive SendGrid event webhooks",
  description:
    "Processes SendGrid delivery, bounce, open, click, spam report, and unsubscribe events for email outbox observability.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: sendgridEventBatchSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Events accepted and processed." },
    "400": { description: "Missing signature headers, invalid JSON, or non-array payload." },
    "403": { description: "The SendGrid signature is invalid." },
    "413": { description: "Webhook body exceeds the accepted byte limit." },
    "500": { description: "Database binding is not configured." },
    "503": { description: "Webhook signature verification is not configured outside local development." },
  },
};
