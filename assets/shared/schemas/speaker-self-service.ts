import { z } from "zod";
import { proposalManageTokenParamsSchema } from "./proposal-management";
import { normalizedEmailSchema, successResponseSchema } from "./api-common";
import { requiredTermSchema } from "./event-read-models";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import {
  MAX_PROPOSAL_PARTICIPANTS,
  proposalManageSpeakerStatusSchema,
  proposalTypeSchema,
} from "./proposal-management";
import { speakerRoleSchema } from "./registration";
import { proposalStatusSchema } from "./proposal-status";
import { httpUrlSchema } from "./urls";

const nullableTimestampSchema = z.string().nullable();

export const speakerSelfServiceAccessSchema = z.object({
  role: speakerRoleSchema,
  status: proposalManageSpeakerStatusSchema,
  confirmedAt: nullableTimestampSchema,
  declinedAt: nullableTimestampSchema,
  termsAcceptedAt: nullableTimestampSchema,
});

export const speakerSelfServiceProposalSchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  proposalType: proposalTypeSchema,
  status: proposalStatusSchema,
  presentationDeadline: nullableTimestampSchema,
  presentationUploaded: z.boolean(),
  presentationUploadedAt: nullableTimestampSchema,
  presentationUploader: z
    .object({
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      uploadedAt: z.string(),
    })
    .nullable(),
  coSpeakers: z
    .array(
      z.object({
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        status: proposalManageSpeakerStatusSchema,
      }),
    )
    .max(MAX_PROPOSAL_PARTICIPANTS - 1),
  presentationUrl: httpUrlSchema.nullable(),
});

export const speakerSelfServiceProfileSchema = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: normalizedEmailSchema,
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  headshotUploaded: z.boolean(),
  headshotUpdatedAt: nullableTimestampSchema,
  headshotUrl: httpUrlSchema.nullable(),
});

export const speakerSelfServiceReadResponseSchema = z.object({
  speaker: speakerSelfServiceAccessSchema,
  proposal: speakerSelfServiceProposalSchema,
  presentationTerms: z.array(requiredTermSchema),
  profile: speakerSelfServiceProfileSchema,
});

export const speakerParticipationResponseSchema = successResponseSchema.extend({
  status: z.enum(["confirmed", "declined"]),
});
export const speakerPresentationUploadResponseSchema = successResponseSchema.extend({ r2Key: z.string().min(1) });

export const speakerPresentationUploadRouteSchema = {
  tags: ["Proposals", "Presentations"],
  summary: "Upload a speaker presentation",
  request: { params: proposalManageTokenParamsSchema },
  responses: {
    "200": {
      description: "Presentation uploaded.",
      content: { "application/json": { schema: speakerPresentationUploadResponseSchema } },
    },
  },
};

export type SpeakerSelfServiceAccess = z.infer<typeof speakerSelfServiceAccessSchema>;
export type SpeakerSelfServiceProposal = z.infer<typeof speakerSelfServiceProposalSchema>;
export type SpeakerSelfServiceReadResponse = z.infer<typeof speakerSelfServiceReadResponseSchema>;
