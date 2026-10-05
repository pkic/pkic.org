import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";

/** Representation recorded for this proposal, independent of subsequent profile edits. */
export const proposalActingIdentitySnapshotSchema = z.object({
  organizationName: z.string().max(200).nullable(),
  jobTitle: z.string().max(200).nullable(),
  biography: z.string().max(10_000).nullable(),
  links: linksSchema,
});

export const proposalActingIdentitySchema = z.object({
  actingIdentityId: databaseIdSchema.nullable(),
  actingIdentitySelectedAt: utcInstantSchema.nullable(),
  actingIdentitySelection: z.enum(["unrecorded", "individual", "identity"]),
});

export const proposalActingIdentitySelectionShape = {
  actingIdentityId: databaseIdSchema.nullable().optional(),
};

export type ProposalActingIdentitySnapshot = z.infer<typeof proposalActingIdentitySnapshotSchema>;
export type ProposalActingIdentity = z.infer<typeof proposalActingIdentitySchema>;
