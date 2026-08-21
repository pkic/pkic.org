import { z } from "zod";
import { adminEmailOutboxQuerySchema, adminEmailTemplateActivateSchema } from "./api";
import { emailTemplateKeyParamsSchema } from "./api-common";
import { adminEmailOutboxResponseSchema } from "./admin-email-outbox";

export const apiRootGetRouteSchema = {
  tags: ["System"],
  summary: "Get API status",
  description: "Returns the API name, version, documentation URL, and current health status.",
  responses: {
    "200": {
      description: "API status metadata.",
      content: {
        "application/json": {
          schema: z.object({
            name: z.string(),
            version: z.string(),
            docs: z.string(),
            status: z.literal("ok"),
          }),
        },
      },
    },
  },
};

export const adminEmailOutboxGetRouteSchema = {
  tags: ["Admin email"],
  summary: "List email outbox messages",
  description:
    "Returns a paginated operational view of queued, sent, failed, bounced, and retryable email outbox rows.",
  request: {
    query: adminEmailOutboxQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated email outbox rows and aggregate delivery summary.",
      content: { "application/json": { schema: adminEmailOutboxResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
  },
};

export const adminEmailTemplateActivateRouteSchema = {
  tags: ["Admin email templates"],
  summary: "Activate an email template version",
  description: "Marks a specific version of an email template as the active version used for future rendering.",
  request: {
    params: emailTemplateKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminEmailTemplateActivateSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Template version activated successfully." },
    "400": { description: "Invalid activation payload." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Template or version not found." },
  },
};
