import { protectsPublicAction } from "./abuse-protection";
import { eventSlugParamsSchema, registrationManageTokenParamsSchema, successResponseSchema } from "./api-common";
import {
  okResponseSchema,
  registrationConfirmInfoQuerySchema,
  registrationConfirmInfoResponseSchema,
  registrationConfirmQuerySchema,
  registrationConfirmResponseSchema,
  registrationConfirmSchema,
  registrationCreateSchema,
  registrationManageReadResponseSchema,
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
  registrationSubmissionResponseSchema,
  registrationResendManageLinkSchema,
  registrationResendConfirmationSchema,
} from "./registration";
import {
  registrationProofPersonPatchSchema,
  registrationProofPersonPatchResponseSchema,
  registrationEmailProofStartResponseSchema,
  registrationEmailProofStartSchema,
  registrationEmailProofVerifyResponseSchema,
  registrationEmailProofVerifySchema,
} from "./registration-email-proof";
import { jsonResponse, requiredJsonBody } from "./openapi";
import { publicOperation } from "./route-contract";
import { screensWorkEmailDomain } from "./work-email";

export const registrationResendManageLinkRouteSchema = {
  ...protectsPublicAction("registration_access", "email:manage"),
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Resend registration management link",
  description:
    "Queues a fresh registration management link when the normalized email matches a registration for this event.",
  request: {
    params: eventSlugParamsSchema,
    body: requiredJsonBody(registrationResendManageLinkSchema),
  },
  responses: {
    "200": jsonResponse(
      "Request accepted. The response is intentionally generic to prevent account enumeration.",
      successResponseSchema,
    ),
    "400": { description: "Invalid email payload." },
    "404": { description: "Event not found." },
    "429": { description: "Rate limit exceeded." },
  },
};

export const eventRegistrationCreateRouteSchema = {
  ...protectsPublicAction("event_registration", "events:manage"),
  ...publicOperation(),
  ...screensWorkEmailDomain(),
  tags: ["Registrations"],
  summary: "Register for an event",
  description:
    "Creates or reactivates an event registration, records configured form answers and consents, and queues confirmation email work.",
  request: {
    params: eventSlugParamsSchema,
    body: requiredJsonBody(registrationCreateSchema),
  },
  responses: {
    "200": jsonResponse("Registration submitted.", registrationSubmissionResponseSchema),
    "400": { description: "Invalid registration, form answers, attendance, invite, or consent." },
    "404": { description: "Event not found." },
    "409": { description: "Registration state or capacity changed concurrently." },
  },
};

export const registrationEmailProofStartRouteSchema = {
  ...protectsPublicAction("registration_email_proof", "events:manage"),
  ...publicOperation(),
  ...screensWorkEmailDomain(),
  tags: ["Registrations"],
  summary: "Verify a registrant's email address",
  description:
    "Queues a short-lived verification link to the address. Opening it returns the person to the registration form with the address verified.",
  request: { params: eventSlugParamsSchema, body: requiredJsonBody(registrationEmailProofStartSchema) },
  responses: {
    "200": jsonResponse("Verification link queued.", registrationEmailProofStartResponseSchema),
    "403": { description: "The event does not take registrations." },
    "404": { description: "Event not found." },
    "422": { description: "The address cannot receive email or is not accepted." },
    "429": { description: "Rate limit exceeded." },
  },
};

export const registrationEmailProofVerifyRouteSchema = {
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Continue a registration with a verified email address",
  request: { params: eventSlugParamsSchema, body: requiredJsonBody(registrationEmailProofVerifySchema) },
  responses: {
    "200": jsonResponse(
      "The verified address and what the form still asks.",
      registrationEmailProofVerifyResponseSchema,
    ),
    "404": { description: "Invalid verification link." },
    "410": { description: "Expired verification link." },
  },
};

export const registrationResendConfirmationRouteSchema = {
  ...protectsPublicAction("registration_confirmation", "email:manage"),
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Resend registration confirmation email",
  description:
    "Rotates the confirmation token and resends the confirmation email for a pending registration using either a current token or recovery email.",
  request: {
    params: eventSlugParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: registrationResendConfirmationSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Resend request accepted.",
      content: {
        "application/json": {
          schema: okResponseSchema,
        },
      },
    },
    "400": { description: "Invalid recovery payload." },
    "404": { description: "No pending registration found for the provided token." },
  },
};

export const registrationConfirmEmailGetRouteSchema = {
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Confirm registration by email link",
  description:
    "Confirms a pending registration using the token and optional registration id from a confirmation email link.",
  request: {
    params: eventSlugParamsSchema,
    query: registrationConfirmQuerySchema,
  },
  responses: {
    "200": {
      description: "Registration confirmed and management/share URLs returned.",
      content: {
        "application/json": {
          schema: registrationConfirmResponseSchema,
        },
      },
    },
    "400": { description: "Missing or invalid token." },
    "404": { description: "Registration confirmation token not found." },
  },
};

export const registrationConfirmEmailPostRouteSchema = {
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Confirm registration",
  description:
    "Confirms a pending registration using a JSON body containing the confirmation token and optional registration id.",
  request: {
    params: eventSlugParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: registrationConfirmSchema,
        },
      },
      required: true,
    },
  },
  responses: registrationConfirmEmailGetRouteSchema.responses,
};

export const registrationConfirmInfoGetRouteSchema = {
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Preview registration confirmation details",
  description:
    "Returns the bounded attendee/event projection for a valid confirmation capability and a generic empty projection otherwise.",
  request: {
    params: eventSlugParamsSchema,
    query: registrationConfirmInfoQuerySchema,
  },
  responses: {
    "200": jsonResponse("Registration confirmation preview.", registrationConfirmInfoResponseSchema),
  },
};

export const registrationManageReadRouteSchema = {
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Read registration self-service state",
  request: { params: registrationManageTokenParamsSchema },
  responses: {
    "200": jsonResponse("Capability-safe registration management view.", registrationManageReadResponseSchema),
    "404": { description: "Registration management capability not found." },
    "410": { description: "Registration management capability expired." },
  },
};

export const registrationManageUpdateRouteSchema = {
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Update registration self-service state",
  request: {
    params: registrationManageTokenParamsSchema,
    body: requiredJsonBody(registrationManageSchema),
  },
  responses: {
    "200": jsonResponse("Registration updated.", registrationManageUpdateResponseSchema),
    "400": { description: "Invalid registration update." },
    "404": { description: "Registration management capability not found." },
    "409": { description: "Registration state or capacity changed concurrently." },
    "410": { description: "Registration management capability expired." },
  },
};

/** A mailbox capability edits only the live owner of that exact address, inside its event. */
export const registrationProofPersonPatchRouteSchema = {
  ...publicOperation(),
  tags: ["Registrations"],
  summary: "Correct the verified registrant's personal details",
  request: { params: eventSlugParamsSchema, body: requiredJsonBody(registrationProofPersonPatchSchema) },
  responses: { "200": jsonResponse("Saved canonical personal details.", registrationProofPersonPatchResponseSchema) },
};
