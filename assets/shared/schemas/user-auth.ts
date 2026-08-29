/** Neutral user identity authentication contracts used by every human UI. */
import { z } from "zod";
import { publicAuthAdminSchema } from "./admin-auth";
import { authMemberSchema } from "./member-auth";
import { emailRecoveryRequestSchema, magicLinkVerifySchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { publicOperation, requiresSession } from "./route-contract";
import { sponsorCapacitySchema } from "./sponsor-access";

export const userAuthRequestSchema = emailRecoveryRequestSchema;
export const userAuthVerifySchema = magicLinkVerifySchema;

export const userIdentitySchema = z.object({
  id: databaseIdSchema,
  email: z.email(),
});

const userCapacityFields = {
  identity: userIdentitySchema,
  staff: publicAuthAdminSchema.optional(),
  member: authMemberSchema.optional(),
  sponsors: z.array(sponsorCapacitySchema).default([]),
};

function requireCapacity<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    (value) => {
      const capacities = value as { staff?: unknown; member?: unknown; sponsors?: unknown[] };
      return (
        capacities.staff !== undefined || capacities.member !== undefined || (capacities.sponsors?.length ?? 0) > 0
      );
    },
    { message: "At least one user capacity is required" },
  );
}

export const userAuthSessionResponseSchema = requireCapacity(successResponseSchema.extend(userCapacityFields));
export const userAuthEstablishedResponseSchema = requireCapacity(
  successResponseSchema.extend({ expiresAt: z.string(), ...userCapacityFields }),
);

export const userAuthRequestRouteSchema = {
  ...publicOperation(),
  tags: ["Authentication"],
  summary: "Request a user sign-in link",
  description: "Sends an enumeration-safe sign-in link when the address has an active user capacity.",
  request: {
    body: { content: { "application/json": { schema: userAuthRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Sign-in link request accepted.",
      content: { "application/json": { schema: successResponseSchema } },
    },
  },
};

export const userAuthVerifyRouteSchema = {
  ...publicOperation(),
  tags: ["Authentication"],
  summary: "Verify a user sign-in link",
  request: {
    body: { content: { "application/json": { schema: userAuthVerifySchema } }, required: true },
  },
  responses: {
    "200": {
      description: "A single user session with all currently eligible capacities.",
      content: { "application/json": { schema: userAuthEstablishedResponseSchema } },
    },
  },
};

export const userAuthSessionRouteSchema = {
  ...requiresSession(),
  tags: ["Authentication"],
  summary: "Get the current user identity and capacities",
  responses: {
    "200": {
      description: "Current live user capacities.",
      content: { "application/json": { schema: userAuthSessionResponseSchema } },
    },
    "401": { description: "No valid user session." },
  },
};

export const userAuthLogoutRouteSchema = {
  ...requiresSession(),
  tags: ["Authentication"],
  summary: "Sign out the current user identity",
  responses: {
    "200": {
      description: "The user session was revoked and cleared.",
      content: { "application/json": { schema: successResponseSchema } },
    },
  },
};
