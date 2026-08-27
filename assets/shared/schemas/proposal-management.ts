import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { defaultedSourceTypeSchema } from "./source";
import { linksSchema } from "./links";
import {
  boundedJsonObject,
  emailRecoveryRequestSchema,
  firstNameSchema,
  jobTitleSchema,
  lastNameSchema,
  normalizedEmailSchema,
  organizationNameSchema,
  successResponseSchema,
  tokenSchema,
  trimmedString,
} from "./api-common";
import { consentItemSchema, participantProfileSchema, proposerProfileSchema, speakerRoleSchema } from "./registration";
import { proposalDecisionStatusSchema, proposalStatusSchema } from "./proposal-status";
import { addDuplicateStringIssues } from "./refinements";
import { httpCapabilityUrlSchema, httpUrlSchema } from "./urls";

/** Event-defined session-type label; allowed values are checked against the event in the service layer. */
export const proposalTypeSchema = trimmedString(2, 64);
export type ProposalType = z.infer<typeof proposalTypeSchema>;
export const proposalSessionTypeSchema = z.object({
  label: proposalTypeSchema,
  requiresPresentation: z.boolean(),
});
export const proposalSessionTypesSchema = z
  .array(proposalSessionTypeSchema)
  .max(20)
  .superRefine((sessionTypes, context) =>
    addDuplicateStringIssues(sessionTypes, context, {
      value: (sessionType) => sessionType.label.toLocaleLowerCase("en-US"),
      path: (index) => [index, "label"],
      label: "Session type",
    }),
  );

const proposalTitleSchema = trimmedString(8, 180);
const proposalAbstractSchema = trimmedString(80, 8000);
export const MAX_PROPOSAL_ADDITIONAL_SPEAKERS = 8;
export const MAX_PROPOSAL_PARTICIPANTS = MAX_PROPOSAL_ADDITIONAL_SPEAKERS + 1;

export const proposalCreateSchema = boundedJsonObject(
  {
    inviteToken: tokenSchema.optional(),
    inviteId: databaseIdSchema.optional(),
    sourceType: defaultedSourceTypeSchema,
    sourceRef: trimmedString(2, 200).optional(),
    referralCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,12}$/)
      .optional(),
    proposer: proposerProfileSchema,
    proposal: z.object({
      type: proposalTypeSchema,
      title: proposalTitleSchema,
      abstract: proposalAbstractSchema,
      details: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
    }),
    speakers: z
      .array(
        participantProfileSchema.extend({
          role: speakerRoleSchema.default("speaker"),
        }),
      )
      .max(MAX_PROPOSAL_ADDITIONAL_SPEAKERS)
      .default([]),
    consents: z.array(consentItemSchema).min(1).max(20),
  },
  40_000,
).superRefine((value, ctx) => {
  const participantEmails = [value.proposer.email, ...value.speakers.map((speaker) => speaker.email)];
  if (new Set(participantEmails).size !== participantEmails.length) {
    ctx.addIssue({
      code: "custom",
      path: ["speakers"],
      message: "Each proposal participant must use a unique email address",
    });
  }
  if (value.proposal.type === "panel") {
    const panelParticipants = value.speakers.filter((speaker) => speaker.role === "panelist");
    if (panelParticipants.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["speakers"],
        message: "Panel proposals require at least one speaker with role 'panelist'",
      });
    }
  }
});

export const proposalCreateResponseSchema = successResponseSchema.extend({
  proposalId: databaseIdSchema,
  status: proposalStatusSchema,
  manageToken: z.string().nullable(),
  manageUrl: httpCapabilityUrlSchema.nullable(),
  shareUrl: httpUrlSchema,
});

export const proposalResendManageLinkSchema = emailRecoveryRequestSchema;

export const proposalResendSpeakerManageLinkSchema = proposalResendManageLinkSchema;

export const inviteResendLinkSchema = proposalResendManageLinkSchema;

export const proposalManageSchema = boundedJsonObject(
  {
    action: z.enum(["update", "withdraw"]),
    proposalType: proposalTypeSchema.optional(),
    title: proposalTitleSchema.optional(),
    abstract: proposalAbstractSchema.optional(),
    details: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  },
  30_000,
).superRefine((value, context) => {
  const updateFields = [value.proposalType, value.title, value.abstract, value.details];
  if (value.action === "update" && updateFields.every((field) => field === undefined)) {
    context.addIssue({ code: "custom", message: "Provide at least one proposal field to update" });
  }
  if (value.action === "withdraw" && updateFields.some((field) => field !== undefined)) {
    context.addIssue({ code: "custom", message: "A withdrawal cannot include proposal field updates" });
  }
});

export const proposalManageTokenParamsSchema = z.object({ token: tokenSchema });

export const proposalManageRecordSchema = z.object({
  id: databaseIdSchema,
  proposer_user_id: databaseIdSchema,
  status: proposalStatusSchema,
  proposal_type: proposalTypeSchema,
  title: z.string(),
  abstract: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
});

export const proposalManageSpeakerStatusSchema = z.enum(["pending", "invited", "confirmed", "declined"]);
export type ProposalManageSpeakerStatus = z.infer<typeof proposalManageSpeakerStatusSchema>;
/** Canonical transport fields shared by proposer and admin speaker views. */
export const proposalSpeakerProfileSchema = z.object({
  userId: databaseIdSchema,
  role: speakerRoleSchema,
  status: proposalManageSpeakerStatusSchema,
  email: normalizedEmailSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  links: linksSchema,
  headshotUpdatedAt: z.string().nullable(),
  headshotUrl: httpUrlSchema.nullable(),
});

export const proposalManageSpeakerSchema = proposalSpeakerProfileSchema.extend({
  confirmedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  bio: z.string().nullable(),
  headshotUploaded: z.boolean(),
});

export const proposalManageReadResponseSchema = successResponseSchema.extend({
  proposal: proposalManageRecordSchema,
  speakers: z.array(proposalManageSpeakerSchema).max(MAX_PROPOSAL_PARTICIPANTS),
});

export const proposalManageUpdateResponseSchema = successResponseSchema.extend({
  proposal: proposalManageRecordSchema,
});

export type ProposalManageResponse = z.infer<typeof proposalManageReadResponseSchema>;

export const finalizeProposalSchema = z
  .object({
    finalStatus: proposalDecisionStatusSchema,
    decisionNote: trimmedString(3, 10_000).optional(),
    presentationDeadline: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    if (value.finalStatus === "needs-work" && !value.decisionNote) {
      context.addIssue({
        code: "custom",
        path: ["decisionNote"],
        message: "A decision note is required when requesting changes",
      });
    }
    if (value.finalStatus !== "accepted" && value.presentationDeadline) {
      context.addIssue({
        code: "custom",
        path: ["presentationDeadline"],
        message: "A presentation deadline is only valid for accepted proposals",
      });
    }
  });

export const finalizeProposalResponseSchema = successResponseSchema.extend({
  decisionId: databaseIdSchema,
  reviewRound: z.number().int().positive(),
  reviewCount: z.number().int().nonnegative(),
  minReviewsRequired: z.number().int().nonnegative(),
});

export const proposalPatchSchema = z
  .object({
    title: proposalTitleSchema.optional(),
    abstract: proposalAbstractSchema.optional(),
  })
  .refine((value) => value.title !== undefined || value.abstract !== undefined, {
    message: "Provide a title or abstract to update",
  });

export const proposalEditableSchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  abstract: z.string(),
  updated_at: z.string(),
});

export const proposalPatchResponseSchema = z.object({
  proposal: proposalEditableSchema,
});

export const cancelAcceptedProposalSchema = z.object({
  comment: z.string().trim().min(1).max(5_000),
});

export const cancelAcceptedProposalResponseSchema = successResponseSchema.extend({
  proposalId: databaseIdSchema,
  status: z.literal("canceled"),
  canceledAt: z.string(),
  notifiedSpeakerCount: z.number().int().nonnegative(),
});

function optionalNullableOrEmpty<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.literal(""), z.null()]).optional();
}

export const speakerProfilePatchSchema = z.object({
  firstName: optionalNullableOrEmpty(firstNameSchema),
  lastName: optionalNullableOrEmpty(lastNameSchema),
  organizationName: optionalNullableOrEmpty(organizationNameSchema),
  jobTitle: optionalNullableOrEmpty(jobTitleSchema),
  biography: optionalNullableOrEmpty(z.string().trim().min(1).max(10_000)),
  links: linksSchema.optional(),
});

export const speakerParticipationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("confirm"),
    consents: z.array(consentItemSchema).min(1).max(20),
  }),
  z.object({
    action: z.literal("decline"),
    reason: z.string().trim().max(2000).optional(),
  }),
]);

export const proposalSpeakerReminderRequestSchema = z.object({
  userId: databaseIdSchema,
});

export const proposerSpeakerPatchSchema = speakerProfilePatchSchema.extend({
  role: speakerRoleSchema.optional(),
});

export const proposalSpeakerPatchSchema = proposerSpeakerPatchSchema;

export const proposalSpeakerRemovalRequestSchema = z.object({
  replacementProposerUserId: databaseIdSchema.optional(),
});

export const proposalSpeakerRemovalResponseSchema = successResponseSchema.extend({
  removedUserId: databaseIdSchema,
  proposerUserId: databaseIdSchema,
  cancelledEmailCount: z.number().int().nonnegative(),
});

export const coSpeakerInviteSchema = z.object({
  email: normalizedEmailSchema,
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
  role: speakerRoleSchema.exclude(["proposer"]).default("speaker"),
  expiresAt: z.iso.datetime().optional(),
});

export const coSpeakerInviteResponseSchema = successResponseSchema.extend({
  email: normalizedEmailSchema,
  role: speakerRoleSchema,
  expiresAt: z.iso.datetime(),
  queued: z.boolean(),
});

export const coSpeakerInviteRouteSchema = {
  tags: ["Proposals", "Speakers"],
  summary: "Invite a co-speaker to a proposal",
  request: {
    params: proposalManageTokenParamsSchema,
    body: { content: { "application/json": { schema: coSpeakerInviteSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Co-speaker invitation state, including whether a new delivery was queued.",
      content: { "application/json": { schema: coSpeakerInviteResponseSchema } },
    },
    "400": { description: "Proposal is closed or the request is invalid." },
  },
};
