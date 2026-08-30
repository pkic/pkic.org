import type { OrganizationCreateInput } from "../../../../assets/shared/schemas/organization-management";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { prepareAuditLog } from "../audit";
import { buildProvisionOrganizationMembership } from "../membership/provisioning";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { authorizedOrganizationMutationDb } from "./authorization";
import { getOrganization } from "./read-model";

/** Creates one organization aggregate through the same provisioner used by YAML import and application approval. */
export async function createOrganization(db: DatabaseLike, actor: UserBackedAuthAdmin, input: OrganizationCreateInput) {
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "membership:write");
  const provision = await buildProvisionOrganizationMembership(authorizedDb, {
    organizationName: input.name,
    website: input.website,
    description: input.description,
    membershipCategory: input.membershipCategory,
    memberSince: input.memberSince,
    representatives: input.representatives.map((representative) => ({
      name: representative.name,
      email: representative.email,
      jobTitle: representative.jobTitle,
      biography: representative.biography,
      links: representative.links,
    })),
    representationSource: "staff",
    workingGroupSlugs: input.workingGroupSlugs,
    grantedByUserId: adminDatabaseUserId(actor),
  });
  const result = provision.buildResult();
  provision.statements.push(
    prepareAuditLog(authorizedDb, "admin", actor.id, "organization_created", "organization", result.organizationId, {
      membershipCategory: input.membershipCategory,
      organizationName: input.name,
      representativeEmails: input.representatives.map((representative) => representative.email),
    }),
  );
  await authorizedDb.batch(provision.statements);
  return getOrganization(db, result.organizationId!);
}
