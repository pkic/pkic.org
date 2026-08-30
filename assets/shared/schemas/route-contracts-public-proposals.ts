import { eventSlugParamsSchema, proposalAccessSpeakerParamsSchema, successResponseSchema } from "./api-common";
import {
  coSpeakerInviteResponseSchema,
  coSpeakerInviteSchema,
  inviteResendLinkSchema,
  proposalCreateResponseSchema,
  proposalCreateSchema,
  proposalAccessPatchResponseSchema,
  proposalAccessPatchSchema,
  proposalAccessReadResponseSchema,
  proposalAccessTokenParamsSchema,
  proposalSpeakerRemovalResponseSchema,
  proposalResendManageLinkSchema,
  proposalResendSpeakerManageLinkSchema,
  proposerSpeakerPatchSchema,
  speakerParticipationPatchSchema,
  speakerProfilePatchSchema,
} from "./proposal-management";
import { jsonResponse, requiredJsonBody } from "./openapi";
import { speakerReminderPreferencePatchSchema, speakerReminderPreferenceResponseSchema } from "./speaker-reminders";
import { speakerParticipationResponseSchema, speakerSelfServiceReadResponseSchema } from "./speaker-self-service";
import { publicOperation } from "./route-contract";

const genericAcceptedResponse = jsonResponse(
  "Request accepted. The response is intentionally generic to prevent account enumeration.",
  successResponseSchema,
);

export const eventProposalCreateRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Submit an event proposal",
  description:
    "Creates a new proposal, proposer profile, optional speaker lineup, consent records, referral code, and transactional confirmation email.",
  request: {
    params: eventSlugParamsSchema,
    body: requiredJsonBody(proposalCreateSchema),
  },
  responses: {
    "200": jsonResponse("Proposal submitted successfully.", proposalCreateResponseSchema),
    "400": { description: "Invalid proposal payload, invite, form answers, or required consent." },
    "404": { description: "Event not found." },
  },
};

export const proposalResendSpeakerManageLinkRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Resend speaker management link",
  description:
    "Sends a fresh management link to a non-proposer speaker when the email matches an active proposal speaker record.",
  request: {
    params: eventSlugParamsSchema,
    body: requiredJsonBody(proposalResendSpeakerManageLinkSchema),
  },
  responses: {
    "200": genericAcceptedResponse,
    "400": { description: "Invalid email payload." },
    "429": { description: "Rate limit exceeded." },
  },
};

export const proposalResendManageLinkRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Resend proposer management link",
  description: "Sends fresh management links when the email matches one or more active proposals for this event.",
  request: {
    params: eventSlugParamsSchema,
    body: requiredJsonBody(proposalResendManageLinkSchema),
  },
  responses: {
    "200": genericAcceptedResponse,
    "400": { description: "Invalid email payload." },
    "429": { description: "Rate limit exceeded." },
  },
};

export const inviteResendLinkRouteSchema = {
  ...publicOperation(),
  tags: ["Invites"],
  summary: "Resend pending invitation links",
  description: "Sends fresh links for active pending invitations matching the supplied email address.",
  request: {
    body: requiredJsonBody(inviteResendLinkSchema),
  },
  responses: {
    "200": genericAcceptedResponse,
    "400": { description: "Invalid email payload." },
    "429": { description: "Rate limit exceeded." },
  },
};

export const proposalAccessReadRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Read a proposal through its management capability",
  request: { params: proposalAccessTokenParamsSchema },
  responses: {
    "200": jsonResponse("Proposal access view.", proposalAccessReadResponseSchema),
    "404": { description: "Proposal management capability not found." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalAccessPatchRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Update or withdraw a proposal through its management capability",
  request: {
    params: proposalAccessTokenParamsSchema,
    body: requiredJsonBody(proposalAccessPatchSchema),
  },
  responses: {
    "200": jsonResponse("Proposal updated.", proposalAccessPatchResponseSchema),
    "400": { description: "Invalid proposal update." },
    "404": { description: "Proposal management capability not found." },
    "409": { description: "Proposal is not editable or changed concurrently." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalAccessCoSpeakerCreateRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals", "Speakers"],
  summary: "Invite a co-speaker to a proposal",
  request: {
    params: proposalAccessTokenParamsSchema,
    body: requiredJsonBody(coSpeakerInviteSchema),
  },
  responses: {
    "200": jsonResponse(
      "Co-speaker invitation state, including whether a new delivery was queued.",
      coSpeakerInviteResponseSchema,
    ),
    "400": { description: "Proposal is closed or the request is invalid." },
    "404": { description: "Proposal management capability not found." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalAccessSpeakerDeleteRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Remove a speaker through proposal management",
  description:
    "Removes a non-proposer speaker while preserving the user and audit history. The final speaker and current proposer cannot be removed through this command.",
  request: {
    params: proposalAccessSpeakerParamsSchema,
  },
  responses: {
    "200": jsonResponse("Speaker removed from the proposal.", proposalSpeakerRemovalResponseSchema),
    "400": { description: "Invalid removal payload." },
    "404": { description: "Proposal management capability or speaker not found." },
    "409": { description: "The final speaker, current proposer, or closed proposal cannot be changed." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalAccessSpeakerReminderCreateRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals", "Reminders"],
  summary: "Remind a proposal speaker through proposal management",
  description: "Queues a profile reminder for a confirmed speaker using the proposer management capability.",
  request: {
    params: proposalAccessSpeakerParamsSchema,
  },
  responses: {
    "200": jsonResponse("Speaker reminder queued.", successResponseSchema),
    "400": { description: "Invalid proposal or speaker identifier." },
    "404": { description: "Proposal management capability or speaker not found." },
    "409": { description: "The proposal or speaker is not eligible for a reminder." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalAccessSpeakerPatchRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals", "Speakers"],
  summary: "Update a proposal speaker through proposal management",
  description: "Updates a speaker profile and role using the proposer management capability.",
  request: {
    params: proposalAccessSpeakerParamsSchema,
    body: requiredJsonBody(proposerSpeakerPatchSchema),
  },
  responses: {
    "200": jsonResponse("Speaker profile updated.", successResponseSchema),
    "400": { description: "Invalid speaker profile." },
    "403": { description: "Speaker has declined participation." },
    "404": { description: "Proposal management capability or speaker not found." },
    "409": { description: "The proposal or speaker profile changed concurrently." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalSpeakerReminderPreferencePatchRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals", "Reminders"],
  summary: "Update presentation reminder preference",
  request: {
    params: proposalAccessTokenParamsSchema,
    body: requiredJsonBody(speakerReminderPreferencePatchSchema),
  },
  responses: {
    "200": jsonResponse("Reminder preference updated.", speakerReminderPreferenceResponseSchema),
    "404": { description: "Speaker management capability not found." },
    "410": { description: "Speaker management capability expired." },
  },
};

export const proposalSpeakerSelfServiceReadRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Read speaker self-service state",
  request: { params: proposalAccessTokenParamsSchema },
  responses: {
    "200": jsonResponse("Capability-safe speaker management view.", speakerSelfServiceReadResponseSchema),
    "404": { description: "Speaker management capability not found." },
    "410": { description: "Speaker management capability expired." },
  },
};

export const proposalSpeakerParticipationRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Confirm or decline speaker participation",
  request: {
    params: proposalAccessTokenParamsSchema,
    body: requiredJsonBody(speakerParticipationPatchSchema),
  },
  responses: {
    "200": jsonResponse("Speaker participation updated.", speakerParticipationResponseSchema),
    "400": { description: "Invalid participation response." },
    "404": { description: "Speaker management capability not found." },
    "409": { description: "Proposal or speaker state changed concurrently." },
    "410": { description: "Speaker management capability expired." },
  },
};

export const proposalSpeakerProfileUpdateRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Update speaker self-service profile",
  request: {
    params: proposalAccessTokenParamsSchema,
    body: requiredJsonBody(speakerProfilePatchSchema),
  },
  responses: {
    "200": jsonResponse("Speaker profile updated.", successResponseSchema),
    "400": { description: "Invalid speaker profile." },
    "403": { description: "Speaker has declined participation." },
    "404": { description: "Speaker management capability not found." },
    "409": { description: "Proposal or speaker profile changed concurrently." },
    "410": { description: "Speaker management capability expired." },
  },
};
