import { z } from "zod";

export const ecDecisionValueSchema = z.enum(["approve", "decline"]);
export type EcDecisionValue = z.infer<typeof ecDecisionValueSchema>;

export const ecDecisionCreateSchema = z
  .object({
    decision: ecDecisionValueSchema,
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "decline" && !value.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required when declining" });
    }
  });

export const ecDecisionResponseSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  decision: ecDecisionValueSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const ecDecisionCreateRouteSchema = {
  tags: ["Membership"],
  summary: "Record an EC review decision",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: ecDecisionCreateSchema } }, required: true },
  },
  responses: {
    "201": { description: "Decision recorded.", content: { "application/json": { schema: ecDecisionResponseSchema } } },
    "403": { description: "Not an EC member." },
    "404": { description: "Application not found." },
    "409": { description: "Application is not currently in EC review." },
    "400": { description: "Missing required reason for a decline." },
  },
};
