import { z } from "zod";
import { proposalAccessTokenParamsSchema } from "./proposal-management";
import { normalizedEmailSchema, successResponseSchema } from "./api-common";
import { requiredTermSchema } from "./event-read-models";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import {
  MAX_PROPOSAL_PARTICIPANTS,
  proposalAccessSpeakerStatusSchema,
  proposalTypeSchema,
} from "./proposal-management";
import { speakerRoleSchema } from "./registration";
import { proposalStatusSchema } from "./proposal-status";
import { httpUrlSchema } from "./urls";
import { publicOperation } from "./route-contract";
import { ALLOWED_PRESENTATION_MIME_TYPES } from "../presentation-upload";
import { proposalActingIdentitySchema } from "./proposal-acting-identity";
import { actingIdentitySchema } from "./identity";

const nullableTimestampSchema = z.string().nullable();

export const speakerSelfServiceAccessSchema = z.object({
  userId: databaseIdSchema.nullable(),
  role: speakerRoleSchema,
  status: proposalAccessSpeakerStatusSchema,
  confirmedAt: nullableTimestampSchema,
  declinedAt: nullableTimestampSchema,
  termsAcceptedAt: nullableTimestampSchema,
});

export const speakerSelfServiceProposalSchema = z.object({
  eventId: databaseIdSchema.optional(),
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
        status: proposalAccessSpeakerStatusSchema,
      }),
    )
    .max(MAX_PROPOSAL_PARTICIPANTS - 1),
  presentationUrl: httpUrlSchema.nullable(),
});

export const speakerSelfServiceProfileSchema = proposalActingIdentitySchema.extend({
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
  /**
   * Whether this page may change the person's own name and headshot: with their
   * live session, or while no mailbox of the account has ever been proved.
   */
  personalDetailsEditable: z.boolean(),
});

/**
 * The identity the speaker speaks as on this proposal, as it is now: the one
 * they chose, or their individual identity when they take part as an
 * individual. `identityId` names it for editing its profile.
 */
export const speakerCurrentRepresentationSchema = proposalActingIdentitySchema
  .extend({
    identityId: databaseIdSchema,
    ...actingIdentitySchema.pick({
      emailId: true,
      email: true,
      organizationId: true,
      organizationName: true,
      jobTitle: true,
      biography: true,
      links: true,
      updatedAt: true,
    }).shape,
  })
  .refine(
    (value) =>
      value.actingIdentitySelectedAt !== null &&
      (value.actingIdentitySelection === "identity"
        ? value.actingIdentityId === value.identityId
        : value.actingIdentitySelection === "individual" &&
          value.actingIdentityId === null &&
          value.emailId === null &&
          value.organizationId === null &&
          value.organizationName === null),
    "A current speaker representation requires an explicit valid selection",
  );

export const speakerSelfServiceReadResponseSchema = z.object({
  speaker: speakerSelfServiceAccessSchema,
  proposal: speakerSelfServiceProposalSchema,
  presentationTerms: z.array(requiredTermSchema),
  profile: speakerSelfServiceProfileSchema,
  currentRepresentation: speakerCurrentRepresentationSchema.nullable(),
});

export const speakerProfileUpdateResponseSchema = successResponseSchema.extend({
  profile: speakerSelfServiceProfileSchema,
  currentRepresentation: speakerCurrentRepresentationSchema.nullable(),
});

export const speakerParticipationResponseSchema = successResponseSchema.extend({
  status: z.enum(["confirmed", "declined"]),
});
export const speakerPresentationUploadResponseSchema = successResponseSchema;

export const speakerPresentationUploadRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals", "Presentations"],
  summary: "Upload a speaker presentation",
  request: { params: proposalAccessTokenParamsSchema },
  responses: {
    "200": {
      description: "Presentation uploaded.",
      content: { "application/json": { schema: speakerPresentationUploadResponseSchema } },
    },
  },
};

const speakerPresentationFileSchema = z.any().describe("Current PDF or presentation file bytes");
const speakerPresentationResponseContent = Object.fromEntries(
  ALLOWED_PRESENTATION_MIME_TYPES.map((mimeType) => [mimeType, { schema: speakerPresentationFileSchema }]),
);
export const speakerPresentationDownloadRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals", "Presentations"],
  summary: "Download the current speaker presentation",
  request: { params: proposalAccessTokenParamsSchema },
  responses: {
    "200": {
      description: "Current presentation file.",
      content: speakerPresentationResponseContent,
    },
    "403": { description: "Speaker participation has not been confirmed." },
    "404": { description: "Speaker capability or presentation not found." },
    "409": { description: "The proposal has not been accepted." },
    "410": { description: "Speaker capability expired." },
    "503": { description: "Presentation storage is unavailable." },
  },
};

export type SpeakerSelfServiceAccess = z.infer<typeof speakerSelfServiceAccessSchema>;
export type SpeakerSelfServiceProposal = z.infer<typeof speakerSelfServiceProposalSchema>;
export type SpeakerSelfServiceReadResponse = z.infer<typeof speakerSelfServiceReadResponseSchema>;
export type SpeakerSelfServiceProfile = z.infer<typeof speakerSelfServiceProfileSchema>;
export type SpeakerCurrentRepresentation = z.infer<typeof speakerCurrentRepresentationSchema>;
