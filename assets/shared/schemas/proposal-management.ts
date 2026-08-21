import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { defaultedSourceTypeSchema } from "./source";
import { linksSchema } from "./links";
import {
  boundedJsonObject,
  firstNameSchema,
  jobTitleSchema,
  lastNameSchema,
  normalizedEmailSchema,
  organizationNameSchema,
  tokenSchema,
  trimmedString,
} from "./api-common";
import { consentItemSchema, participantProfileSchema, proposerProfileSchema, speakerRoleSchema } from "./registration";

export const proposalTypeSchema = z.enum([
  "keynote",
  "talk",
  "workshop",
  "panel",
  "tutorial",
  "lightning_talk",
  "roundtable",
  "birds_of_a_feather",
  "fireside_chat",
  "demo",
]);

const proposalTitleSchema = trimmedString(8, 180);
const proposalAbstractSchema = trimmedString(80, 8000);

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
      .max(8)
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

export const proposalCreateResponseSchema = z.object({
  success: z.boolean(),
  proposalId: databaseIdSchema,
  status: z.string(),
  manageToken: z.string(),
  manageUrl: z.string().url(),
  shareUrl: z.string().url(),
});

export const proposalResendManageLinkSchema = z.object({
  email: normalizedEmailSchema,
});

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
);

export const reviewUpsertSchema = z.object({
  recommendation: z.enum(["accept", "reject", "needs-work"]),
  score: z.number().int().min(1).max(10),
  reviewerComment: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    trimmedString(3, 10_000).optional(),
  ),
  applicantNote: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    trimmedString(3, 10_000).optional(),
  ),
});

export const reviewPatchSchema = z.object({
  recommendation: z.enum(["accept", "reject", "needs-work"]).optional(),
  score: z.number().int().min(1).max(10).nullable().optional(),
  reviewerComment: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    trimmedString(3, 10_000).nullable().optional(),
  ),
  applicantNote: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    trimmedString(3, 10_000).nullable().optional(),
  ),
});

export const finalizeProposalSchema = z.object({
  finalStatus: z.enum(["accepted", "rejected", "needs-work"]),
  decisionNote: trimmedString(3, 10_000).optional(),
  presentationDeadline: z.iso.datetime().optional(),
});

export const adminProposalPatchSchema = z.object({
  title: proposalTitleSchema.optional(),
  abstract: proposalAbstractSchema.optional(),
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

export const proposerSpeakerPatchSchema = speakerProfilePatchSchema.extend({
  role: speakerRoleSchema.optional(),
});

export const adminSpeakerBioPatchSchema = proposerSpeakerPatchSchema;

export const coSpeakerInviteSchema = z.object({
  email: normalizedEmailSchema,
  firstName: firstNameSchema.optional(),
  lastName: lastNameSchema.optional(),
  role: speakerRoleSchema.exclude(["proposer"]).default("speaker"),
});
