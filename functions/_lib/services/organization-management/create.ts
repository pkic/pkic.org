import type { OrganizationCreateInput } from "../../../../assets/shared/schemas/organization-management";
import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { prepareAuditLog } from "../audit";
import { buildProvisionOrganizationMembership } from "../membership/provisioning";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { authorizedOrganizationMutationDb } from "./authorization";
import { getOrganization } from "./read-model";

/**
 * Creates one organization aggregate through the same provisioner used by
 * YAML import and application approval.
 *
 * Initial identities are optional. Providing any activates them immediately
 * — skipping the invitation flow — so that path alone demands the
 * `identities:activate` permission (checked again here, inside the mutation
 * guard, so a mid-request revocation still rolls the batch back) and carries
 * the caller's activation reason into the audit log.
 */
export async function createOrganization(db: DatabaseLike, actor: UserBackedAuthAdmin, input: OrganizationCreateInput) {
  const activatesIdentities = input.identities.length > 0;
  const requiredPermissions: Permission[] = activatesIdentities
    ? ["membership:write", "identities:activate"]
    : ["membership:write"];
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, requiredPermissions);
  const provision = await buildProvisionOrganizationMembership(authorizedDb, {
    organizationName: input.name,
    website: input.website,
    description: input.description,
    links: input.links,
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
    activateIdentities: activatesIdentities,
    workingGroupSlugs: input.workingGroupSlugs,
    grantedByUserId: adminDatabaseUserId(actor),
  });
  const result = provision.buildResult();
  provision.statements.push(
    prepareAuditLog(authorizedDb, "admin", actor.id, "organization_created", "organization", result.organizationId, {
      membershipCategory: input.membershipCategory,
      organizationName: input.name,
      identityEmails: input.identities.map((identity) => identity.email),
      ...(activatesIdentities ? { activationReason: input.activationReason } : {}),
    }),
  );
  await authorizedDb.batch(provision.statements);
  return getOrganization(db, result.organizationId!);
}
