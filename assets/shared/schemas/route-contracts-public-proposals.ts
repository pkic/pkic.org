import { eventSlugParamsSchema, proposerManagedSpeakerParamsSchema, successResponseSchema } from "./api-common";
import {
  inviteResendLinkSchema,
  proposalCreateResponseSchema,
  proposalCreateSchema,
  proposalManageReadResponseSchema,
  proposalManageSchema,
  proposalManageTokenParamsSchema,
  proposalManageUpdateResponseSchema,
  proposalSpeakerRemovalResponseSchema,
  proposalResendManageLinkSchema,
  proposalResendSpeakerManageLinkSchema,
} from "./proposal-management";
import { jsonResponse, requiredJsonBody } from "./openapi";
import { speakerReminderPreferenceResponseSchema, speakerReminderPreferenceSchema } from "./speaker-reminders";

const genericAcceptedResponse = jsonResponse(
  "Request accepted. The response is intentionally generic to prevent account enumeration.",
  successResponseSchema,
);

export const eventProposalCreateRouteSchema = {
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
  tags: ["Invites"],
  summary: "Resend pending invitation links",
  description: "Sends fresh links for pending or expired invitations matching the supplied email address.",
  request: {
    body: requiredJsonBody(inviteResendLinkSchema),
  },
  responses: {
    "200": genericAcceptedResponse,
    "400": { description: "Invalid email payload." },
    "429": { description: "Rate limit exceeded." },
  },
};

export const proposalManageReadRouteSchema = {
  tags: ["Proposals"],
  summary: "Read a proposal through its management capability",
  request: { params: proposalManageTokenParamsSchema },
  responses: {
    "200": jsonResponse("Proposal management view.", proposalManageReadResponseSchema),
    "404": { description: "Proposal management capability not found." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalManageUpdateRouteSchema = {
  tags: ["Proposals"],
  summary: "Update or withdraw a proposal through its management capability",
  request: {
    params: proposalManageTokenParamsSchema,
    body: requiredJsonBody(proposalManageSchema),
  },
  responses: {
    "200": jsonResponse("Proposal updated.", proposalManageUpdateResponseSchema),
    "400": { description: "Invalid proposal update." },
    "404": { description: "Proposal management capability not found." },
    "409": { description: "Proposal is not editable or changed concurrently." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposerManagedSpeakerDeleteRouteSchema = {
  tags: ["Proposals"],
  summary: "Remove a speaker through proposal management",
  description:
    "Removes a non-proposer speaker while preserving the user and audit history. The final speaker and current proposer cannot be removed through this command.",
  request: {
    params: proposerManagedSpeakerParamsSchema,
  },
  responses: {
    "200": jsonResponse("Speaker removed from the proposal.", proposalSpeakerRemovalResponseSchema),
    "400": { description: "Invalid removal payload." },
    "404": { description: "Proposal management capability or speaker not found." },
    "409": { description: "The final speaker, current proposer, or closed proposal cannot be changed." },
    "410": { description: "Proposal management capability expired." },
  },
};

export const proposalSpeakerReminderPreferenceRouteSchema = {
  tags: ["Proposals", "Reminders"],
  summary: "Update presentation reminder preference",
  request: {
    params: proposalManageTokenParamsSchema,
    body: requiredJsonBody(speakerReminderPreferenceSchema),
  },
  responses: {
    "200": jsonResponse("Reminder preference updated.", speakerReminderPreferenceResponseSchema),
    "404": { description: "Speaker management capability not found." },
    "410": { description: "Speaker management capability expired." },
  },
};
