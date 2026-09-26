import type { OrganizationCreateInput } from "../../../../assets/shared/schemas/organization-management";
import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { prepareAuditLog } from "../audit";
import { nowIso } from "../../utils/time";
import { buildProvisionOrganizationMembership, buildResolveOrganizationStatements } from "../membership/provisioning";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { authorizedOrganizationMutationDb } from "./authorization";
import { getOrganization } from "./read-model";

/**
 * Creates one organization, and a membership for it only when asked.
 *
 * Writing an organization down is not admitting a member. The consortium
 * keeps records for organizations it is not in membership with — an
 * attendee's employer, a sponsor, a company in conversation — and membership
 * arrives by its own act: an application the organization signs up through,
 * or an explicit grant. This used to provision a member aggregate every time,
 * so every organization became a member the moment somebody recorded it.
 *
 * With a membership it is the same provisioner the YAML import and
 * application approval use. Without one it stops at the organization row: no
 * category, no standing, and nobody acting for it, because representatives
 * and group seats are a membership's and it has none.
 *
 * Initial identities are optional and belong to the membership path. Providing
 * any activates them immediately — skipping the invitation flow — so that path
 * alone demands the `identities:activate` permission (checked again here,
 * inside the mutation guard, so a mid-request revocation still rolls the batch
 * back) and carries the caller's activation reason into the audit log.
 */
export async function createOrganization(db: DatabaseLike, actor: UserBackedAuthAdmin, input: OrganizationCreateInput) {
  const activatesIdentities = input.identities.length > 0;
  const requiredPermissions: Permission[] = activatesIdentities
    ? ["membership:write", "identities:activate"]
    : ["membership:write"];
  const authorizedDb = authorizedOrganizationMutationDb(db, actor, requiredPermissions);

  if (!input.membershipCategory) {
    const record = await buildResolveOrganizationStatements(
      authorizedDb,
      {
        organizationName: input.name,
        website: input.website,
        description: input.description,
        links: input.links,
      },
      nowIso(),
    );
    record.statements.push(
      prepareAuditLog(authorizedDb, "admin", actor.id, "organization_created", "organization", record.organizationId, {
        organizationName: input.name,
        membershipCategory: null,
      }),
    );
    await authorizedDb.batch(record.statements);
    return getOrganization(db, record.organizationId);
  }

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
