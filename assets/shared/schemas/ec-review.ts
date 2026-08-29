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
