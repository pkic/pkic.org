/**
 * The profile of one identity its owner holds: the job title, biography and
 * links that every record made as the identity shows, and that the owner's
 * public profile shows. One edit contract for every identity the person
 * holds, whichever one the session acts as.
 */
import { z } from "zod";
import { jobTitleTextSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { requiresSession } from "./route-contract";

/** The fields of an identity its owner edits; `myProfileUpdateSchema` extends it with the person's names. */
export const identityProfileUpdateSchema = z.object({
  jobTitle: jobTitleTextSchema.optional(),
  biography: z.string().trim().max(5000).optional(),
  links: linksSchema.optional(),
});
export type IdentityProfileUpdate = z.infer<typeof identityProfileUpdateSchema>;

/**
 * The owner's edit also answers the automatic check of the job title and biography: after the check's advice,
 * saving again with `adviceAcknowledged` keeps the text as written. Staff edits are not checked and do not take it.
 */
export const ownIdentityProfileUpdateSchema = identityProfileUpdateSchema.extend({
  adviceAcknowledged: z.boolean().optional(),
});
export type OwnIdentityProfileUpdate = z.infer<typeof ownIdentityProfileUpdateSchema>;

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
    body: { content: { "application/json": { schema: ownIdentityProfileUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "The updated profile.",
      content: { "application/json": { schema: ownIdentityProfileSchema } },
    },
    "404": { description: "The caller holds no active identity with this ID." },
    "422": {
      description:
        "The automatic check blocks the job title or biography, or advises on it: save again with adviceAcknowledged to keep it as written.",
    },
    "409": { description: "The identity or the acting session changed before the edit was saved." },
  },
};
