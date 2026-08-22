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
import { jsonResponse, requiredJsonBody } from "./openapi";

export const registrationResendManageLinkRouteSchema = {
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

export const registrationResendConfirmationRouteSchema = {
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
