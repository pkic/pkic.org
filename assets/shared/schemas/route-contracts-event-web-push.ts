import { requiresSession } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  eventWebPushRevokeResponseSchema,
  eventWebPushConfigurationSchema,
  eventWebPushDeviceParamsSchema,
  eventWebPushRegisterSchema,
  eventWebPushStatusSchema,
} from "./event-web-push";
const common = {
  ...requiresSession(),
  tags: ["Events"],
  responses: {
    "401": jsonErrorResponse("Sign in required"),
    "403": jsonErrorResponse("This device belongs to another user"),
  },
};
export const eventWebPushConfigurationRouteSchema = {
  ...common,
  summary: "Read browser notification availability",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...common.responses,
    "200": {
      description: "Public notification configuration",
      content: { "application/json": { schema: eventWebPushConfigurationSchema } },
    },
  },
};
export const eventWebPushStatusRouteSchema = {
  ...common,
  summary: "Read your device's event notification consent",
  request: { params: eventSlugParamsSchema.extend(eventWebPushDeviceParamsSchema.shape) },
  responses: {
    ...common.responses,
    "200": {
      description: "Owned device status",
      content: { "application/json": { schema: eventWebPushStatusSchema } },
    },
  },
};
export const eventWebPushRegisterRouteSchema = {
  ...common,
  summary: "Opt your browser into event notifications",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventWebPushRegisterSchema } } },
  },
  responses: {
    ...common.responses,
    "200": {
      description: "Owned device event consent",
      content: { "application/json": { schema: eventWebPushStatusSchema } },
    },
    "409": jsonErrorResponse("Device ownership or subscription conflict"),
    "503": jsonErrorResponse("Browser notifications are not configured"),
  },
};
export const eventWebPushRevokeRouteSchema = {
  ...common,
  summary: "Disable your device's event notifications",
  request: { params: eventSlugParamsSchema.extend(eventWebPushDeviceParamsSchema.shape) },
  responses: {
    ...common.responses,
    "200": {
      description: "Consent revoked",
      content: { "application/json": { schema: eventWebPushRevokeResponseSchema } },
    },
  },
};

export const ownedWebPushDeviceRevokeRouteSchema = {
  ...eventWebPushRevokeRouteSchema,
  summary: "Revoke your browser notification device across all events",
  request: { params: eventWebPushDeviceParamsSchema },
};
