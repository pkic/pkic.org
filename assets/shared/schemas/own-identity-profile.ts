/**
 * The profile of one identity its owner holds: the job title, biography and
 * links that every record made as the identity shows, and that the owner's
 * public profile shows. One edit contract for every identity the person
 * holds, whichever one the session acts as.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { requiresSession } from "./route-contract";

/** The fields of an identity its owner edits; `myProfileUpdateSchema` extends it with the person's names. */
export const identityProfileUpdateSchema = z.object({
  jobTitle: z.string().trim().max(160).optional(),
  biography: z.string().trim().max(5000).optional(),
  links: linksSchema.optional(),
});
export type IdentityProfileUpdate = z.infer<typeof identityProfileUpdateSchema>;

export const ownIdentityProfileSchema = z.object({
  identityId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
});
export type OwnIdentityProfile = z.infer<typeof ownIdentityProfileSchema>;

export const ownIdentityProfileParamsSchema = z.object({ identityId: databaseIdSchema });

export const ownIdentityProfileGetRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Get the profile of one of the current user's identities",
  request: { params: ownIdentityProfileParamsSchema },
  responses: {
    "200": {
      description: "The identity's profile.",
      content: { "application/json": { schema: ownIdentityProfileSchema } },
    },
    "404": { description: "The caller holds no active identity with this ID." },
  },
};

export const ownIdentityProfileUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Update the profile of one of the current user's identities",
  description:
    "Edits any active identity the caller holds without changing the identity the session acts as. Every edit is audited with the previous values, because records that name the identity show the edited values.",
  request: {
    params: ownIdentityProfileParamsSchema,
    body: { content: { "application/json": { schema: identityProfileUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "The updated profile.",
      content: { "application/json": { schema: ownIdentityProfileSchema } },
    },
    "404": { description: "The caller holds no active identity with this ID." },
    "409": { description: "The identity or the acting session changed before the edit was saved." },
  },
};
