/** Immutable, ordered membership requirements shared by forms and execution. */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema, trimmedString } from "./api-common";
import { donationCheckoutSchema } from "./donation";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const membershipReviewAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active_voting_members") }),
  z.object({ kind: z.literal("executive_council") }),
  z.object({ kind: z.literal("group"), groupId: databaseIdSchema }),
]);
export type MembershipReviewAudience = z.infer<typeof membershipReviewAudienceSchema>;
export const membershipNoticeDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mailing_list"), mailingListId: databaseIdSchema }),
  z.object({ kind: z.literal("external"), email: z.email().trim().toLowerCase().max(254) }),
]);
const workflowStepBaseSchema = z.object({
  id: databaseIdSchema,
  label: trimmedString(1, 120),
  instructions: z.string().trim().max(2000),
});
export const membershipWorkflowStepSchema = z.discriminatedUnion("kind", [
  workflowStepBaseSchema.extend({
    kind: z.literal("staff_review"),
    reviewerGroupId: databaseIdSchema.nullable(),
  }),
  workflowStepBaseSchema.extend({
    kind: z.literal("consensus"),
    audience: membershipReviewAudienceSchema,
    destination: membershipNoticeDestinationSchema,
    durationDays: z.number().int().min(1).max(90),
    objectionHandling: z.enum(["hold_for_resolution", "refer_next"]),
  }),
  workflowStepBaseSchema.extend({
    kind: z.literal("payment"),
    feeReference: trimmedString(1, 200),
    ...donationCheckoutSchema.pick({ amount: true, currency: true }).shape,
    deadlineDays: z.number().int().min(1).max(365),
  }),
]);
export type MembershipWorkflowStep = z.infer<typeof membershipWorkflowStepSchema>;

export const membershipWorkflowDefinitionSchema = z
  .object({
    name: trimmedString(1, 120),
    policyReference: trimmedString(1, 500),
    steps: z.array(membershipWorkflowStepSchema).min(1).max(8),
  })
  .superRefine((definition, context) => {
    const ids = new Set<string>();
    definition.steps.forEach((step, index) => {
      if (ids.has(step.id))
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: "Each step must have a unique identity",
        });
      ids.add(step.id);
      if (
        step.kind === "consensus" &&
        step.objectionHandling === "refer_next" &&
        !definition.steps.slice(index + 1).some((following) => following.kind !== "payment")
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "objectionHandling"],
          message: "Referring an objection requires a following review step",
        });
      }
    });
    if (definition.steps.filter((step) => step.kind === "payment").length > 1) {
      context.addIssue({ code: "custom", path: ["steps"], message: "A membership workflow supports one required fee" });
    }
  });
export type MembershipWorkflowDefinition = z.infer<typeof membershipWorkflowDefinitionSchema>;
export const membershipWorkflowVersionSchema = z.object({
  id: databaseIdSchema,
  workflowId: databaseIdSchema,
  version: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  status: z.enum(["draft", "published"]),
  definition: membershipWorkflowDefinitionSchema,
  createdAt: utcInstantSchema,
  publishedAt: utcInstantSchema.nullable(),
});
export type MembershipWorkflowVersion = z.infer<typeof membershipWorkflowVersionSchema>;
export const membershipWorkflowVersionResponseSchema = z.object({ workflow: membershipWorkflowVersionSchema });
export const membershipWorkflowsQuerySchema = listQuerySchema(["name", "createdAt", "version"] as const).extend({
  status: membershipWorkflowVersionSchema.shape.status.optional(),
});
export type MembershipWorkflowsQuery = z.infer<typeof membershipWorkflowsQuerySchema>;
export const membershipWorkflowsResponseSchema = paginatedResponseSchema("workflows", membershipWorkflowVersionSchema);
export const membershipWorkflowCreateSchema = z.object({
  definition: membershipWorkflowDefinitionSchema,
  sourceVersionId: databaseIdSchema.optional(),
});
export const membershipWorkflowUpdateSchema = z.object({
  definition: membershipWorkflowDefinitionSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export const membershipWorkflowPublishSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  reason: trimmedString(3, 2000),
});

export const MEMBERSHIP_APPLICATION_LIFECYCLES = [
  "submitted",
  "processing",
  "on_hold",
  "approved",
  "declined",
  "withdrawn",
] as const;
export const membershipApplicationLifecycleSchema = z.enum(MEMBERSHIP_APPLICATION_LIFECYCLES);
export const membershipWorkflowStepProgressSchema = z.object({
  stepId: databaseIdSchema,
  position: z.number().int().nonnegative(),
  label: z.string(),
  kind: membershipWorkflowStepSchema.options[0].shape.kind.or(z.literal("consensus")).or(z.literal("payment")),
  instructions: z.string(),
  state: z.enum(["waiting", "active", "complete"]),
  openedAt: utcInstantSchema.nullable(),
  deadlineAt: utcInstantSchema.nullable(),
  completedAt: utcInstantSchema.nullable(),
  noticeStatus: z.string().nullable(),
  review: z.object({ who: z.string(), where: z.string().nullable() }).nullable(),
  payment: z
    .object({
      amount: z.number().int(),
      currency: z.string(),
      status: z.string(),
      checkoutUrl: z.url().nullable(),
      handlingRequired: z.boolean(),
    })
    .nullable(),
  blocker: z.string().nullable(),
});
export const membershipWorkflowProgressSchema = z.object({
  versionId: databaseIdSchema,
  name: z.string(),
  version: z.number().int().positive(),
  lifecycle: membershipApplicationLifecycleSchema,
  revision: z.number().int().nonnegative(),
  steps: z.array(membershipWorkflowStepProgressSchema).max(8),
});
export type MembershipWorkflowProgress = z.infer<typeof membershipWorkflowProgressSchema>;

export const membershipWorkflowActionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  reason: trimmedString(3, 2000),
});
export const membershipWorkflowObjectionCreateSchema = membershipWorkflowActionSchema.extend({
  body: trimmedString(3, 5000),
  onBehalfOfUserId: databaseIdSchema.optional(),
});
export const membershipWorkflowObjectionResolveSchema = membershipWorkflowActionSchema.extend({
  resolution: z.enum(["withdrawn", "resolved", "upheld", "overruled"]),
});
export const membershipWorkflowObjectionSchema = z.object({
  id: databaseIdSchema,
  position: z.number().int().nonnegative(),
  authorUserId: databaseIdSchema.nullable(),
  authorLabel: z.string(),
  recordedByLabel: z.string().nullable(),
  recordedByUserId: databaseIdSchema.nullable(),
  body: z.string(),
  state: z.enum(["unresolved", "withdrawn", "resolved", "upheld", "overruled"]),
  resolutionReason: z.string().nullable(),
  resolvedByUserId: databaseIdSchema.nullable(),
  resolvedAt: utcInstantSchema.nullable(),
  createdAt: utcInstantSchema,
});
export const membershipWorkflowObjectionsQuerySchema = listQuerySchema(["createdAt", "state"] as const);
export const membershipWorkflowObjectionsResponseSchema = paginatedResponseSchema(
  "objections",
  membershipWorkflowObjectionSchema,
);
