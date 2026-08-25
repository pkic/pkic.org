import { z } from "zod";
import { publicAuthAdminSchema } from "./admin-auth";
import { emailRecoveryRequestSchema, magicLinkVerifySchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { authMemberSchema } from "./member-auth";

export const portalAuthRequestSchema = emailRecoveryRequestSchema;
export const portalAuthVerifySchema = magicLinkVerifySchema;

export const portalIdentitySchema = z.object({
  id: databaseIdSchema,
  email: z.email(),
});

const portalCapacityFields = {
  identity: portalIdentitySchema,
  admin: publicAuthAdminSchema.optional(),
  member: authMemberSchema.optional(),
};

function requirePortalCapacity<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    (value) => {
      const capacities = value as { admin?: unknown; member?: unknown };
      return capacities.admin !== undefined || capacities.member !== undefined;
    },
    { message: "At least one portal capacity is required" },
  );
}

export const portalSessionResponseSchema = requirePortalCapacity(successResponseSchema.extend(portalCapacityFields));
export const portalSessionEstablishedResponseSchema = requirePortalCapacity(
  successResponseSchema.extend({ expiresAt: z.string(), ...portalCapacityFields }),
);

export const portalAuthRequestRouteSchema = {
  tags: ["Portal Auth"],
  summary: "Request a portal sign-in link",
  description:
    "Sends one identity sign-in link when the primary email currently has staff or member portal capacity. The response is enumeration-safe.",
  request: {
    body: { content: { "application/json": { schema: portalAuthRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Sign-in link sent when the identity is eligible.",
      content: { "application/json": { schema: successResponseSchema } },
    },
  },
};

export const portalAuthVerifyRouteSchema = {
  tags: ["Portal Auth"],
  summary: "Verify a portal sign-in link",
  request: {
    body: { content: { "application/json": { schema: portalAuthVerifySchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Every currently eligible identity capacity was established.",
      content: { "application/json": { schema: portalSessionEstablishedResponseSchema } },
    },
    "403": { description: "The identity no longer has portal capacity." },
    "404": { description: "The sign-in link is invalid." },
    "409": { description: "The sign-in link was already used." },
    "410": { description: "The sign-in link expired." },
  },
};

export const portalAuthSessionRouteSchema = {
  tags: ["Portal Auth"],
  summary: "Get the current portal identity and capacities",
  responses: {
    "200": {
      description: "Current live portal capacities.",
      content: { "application/json": { schema: portalSessionResponseSchema } },
    },
    "401": { description: "No valid portal session capacity." },
  },
};

export const portalAuthLogoutRouteSchema = {
  tags: ["Portal Auth"],
  summary: "Sign out of every portal capacity",
  responses: {
    "200": {
      description: "All portal session cookies were revoked and cleared.",
      content: { "application/json": { schema: successResponseSchema } },
    },
  },
};
