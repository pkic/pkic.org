import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";

/**
 * Which identity a speaker chose to speak as on one proposal, and when. The
 * choice names the identity; what the identity says — organization, title,
 * biography, links — is read from the identity itself, never stored here.
 */
export const proposalActingIdentitySchema = z.object({
  actingIdentityId: databaseIdSchema.nullable(),
  actingIdentitySelectedAt: utcInstantSchema.nullable(),
  actingIdentitySelection: z.enum(["unrecorded", "individual", "identity"]),
});

export const proposalActingIdentitySelectionShape = {
  actingIdentityId: databaseIdSchema.nullable().optional(),
};

export type ProposalActingIdentity = z.infer<typeof proposalActingIdentitySchema>;
