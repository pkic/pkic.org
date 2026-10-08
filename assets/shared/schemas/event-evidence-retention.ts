import { z } from "zod";
import { successResponseSchema, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { authErrors, ok, requiresPermissions } from "./route-contract";

export const EVIDENCE_RETENTION_PURPOSES = {
  attendance_review: "Review attendance and scan records",
  operational_review: "Review event operations",
  compliance_review: "Support a compliance review",
} as const;
export const EVIDENCE_RETENTION_HOLD_REASONS = {
  review_in_progress: "A review is still in progress",
  incident_investigation: "An incident is being investigated",
  preservation_request: "Evidence preservation was requested",
} as const;
const purposeCodeSchema = z.enum(
  Object.keys(EVIDENCE_RETENTION_PURPOSES) as [
    keyof typeof EVIDENCE_RETENTION_PURPOSES,
    ...(keyof typeof EVIDENCE_RETENTION_PURPOSES)[],
  ],
);
const holdReasonCodeSchema = z.enum(
  Object.keys(EVIDENCE_RETENTION_HOLD_REASONS) as [
    keyof typeof EVIDENCE_RETENTION_HOLD_REASONS,
    ...(keyof typeof EVIDENCE_RETENTION_HOLD_REASONS)[],
  ],
);
export const eventEvidenceRetentionPolicyFieldsSchema = z
  .object({
    evidenceUntil: utcInstantSchema.nullable(),
    purposeCode: purposeCodeSchema.nullable(),
    legalHold: z.boolean(),
    holdReasonCode: holdReasonCodeSchema.nullable(),
  })
  .strict();
export const eventEvidenceRetentionPolicyUpdateSchema = eventEvidenceRetentionPolicyFieldsSchema
  .extend({
    expectedRevision: z.number().int().nonnegative(),
    operationId: z.string().uuid(),
  })
  .superRefine((value, ctx) => {
    if ((value.evidenceUntil === null) !== (value.purposeCode === null))
      ctx.addIssue({
        code: "custom",
        path: ["purposeCode"],
        message: "A cutoff and retention purpose must be configured together.",
      });
    if (value.legalHold !== (value.holdReasonCode !== null))
      ctx.addIssue({
        code: "custom",
        path: ["holdReasonCode"],
        message: "Choose a reason for pausing evidence removal; clear it when resuming removal.",
      });
  });
export type EventEvidenceRetentionPolicyUpdate = z.infer<typeof eventEvidenceRetentionPolicyUpdateSchema>;
export const eventEvidenceRetentionPolicyMutationResponseSchema = successResponseSchema.extend({
  eventId: databaseIdSchema,
  revision: z.number().int().nonnegative(),
  policy: eventEvidenceRetentionPolicyFieldsSchema,
});
export const eventEvidenceRetentionPolicyResponseSchema = eventEvidenceRetentionPolicyMutationResponseSchema.extend({
  captureClosedAt: utcInstantSchema.nullable(),
  purgedAt: utcInstantSchema.nullable(),
  status: z.enum(["unconfigured", "retained", "due", "held", "purged"]),
});
export type EventEvidenceRetentionPolicyResponse = z.infer<typeof eventEvidenceRetentionPolicyResponseSchema>;
const routeBase = {
  tags: ["Retention"],
  ...requiresPermissions("retention:read", "events:manage"),
  request: { params: z.object({ eventId: databaseIdSchema }) },
  responses: {
    ...ok("Event raw evidence policy.", eventEvidenceRetentionPolicyResponseSchema),
    ...authErrors({
      forbidden: "Requires retention authority and management of this exact event.",
      conflict: "Policy revision or authorization changed.",
    }),
  },
};
export const eventEvidenceRetentionPolicyReadRouteSchema = {
  ...routeBase,
  summary: "Read event raw evidence retention policy",
};
export const eventEvidenceRetentionPolicyUpdateRouteSchema = {
  ...routeBase,
  ...requiresPermissions("retention:read", "retention:run", "events:manage"),
  summary: "Set event raw evidence retention policy",
  request: {
    ...routeBase.request,
    body: { required: true, content: { "application/json": { schema: eventEvidenceRetentionPolicyUpdateSchema } } },
  },
  responses: {
    ...routeBase.responses,
    ...ok("Saved event raw evidence policy snapshot.", eventEvidenceRetentionPolicyMutationResponseSchema),
  },
};
