import type { OrganizationCreateInput } from "../../../../assets/shared/schemas/organization-management";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { prepareAuditLog } from "../audit";
import { buildProvisionOrganizationMembership } from "../membership/provisioning";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { authorizedOrganizationMutationDb } from "./authorization";
import { getOrganization } from "./read-model";

/** Creates one organization aggregate through the same provisioner used by YAML import and application approval. */
export async function createOrganization(db: DatabaseLike, actor: UserBackedAuthAdmin, input: OrganizationCreateInput) {
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, ["membership:write", "identities:activate"]);
  const provision = await buildProvisionOrganizationMembership(authorizedDb, {
    organizationName: input.name,
    website: input.website,
    description: input.description,
    membershipCategory: input.membershipCategory,
    memberSince: input.memberSince,
    identities: input.identities.map((identity) => ({
      name: identity.name,
      email: identity.email,
      jobTitle: identity.jobTitle,
      biography: identity.biography,
      links: identity.links,
    })),
    identitySource: "staff",
    activateIdentities: true,
    workingGroupSlugs: input.workingGroupSlugs,
    grantedByUserId: adminDatabaseUserId(actor),
  });
  const result = provision.buildResult();
  provision.statements.push(
    prepareAuditLog(authorizedDb, "admin", actor.id, "organization_created", "organization", result.organizationId, {
      membershipCategory: input.membershipCategory,
      organizationName: input.name,
      identityEmails: input.identities.map((identity) => identity.email),
      activationReason: input.activationReason,
    }),
  );
  await authorizedDb.batch(provision.statements);
  return getOrganization(db, result.organizationId!);
}
