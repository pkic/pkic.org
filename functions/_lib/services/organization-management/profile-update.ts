/**
 * Organization profile update — the "manage an organization once
 * it's approved" surface the Interim Admin Tool didn't provide (that tool
 * only ever created new org+member rows, with no way to edit a profile
 * afterward). Split from the prior combined organization module (PR #1
 * review, Phase 8) — see read-model.ts for reads and representative-provisioning.ts for
 * representative/member provisioning.
 */
import { all, first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { normalizeOrgName } from "../sponsorship";
import { buildGetOrCreateOrganizationMemberAggregateStatements } from "../membership/memberships";
import { isActiveRepresentative } from "../membership/representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  buildAssignRepresentativeRoleStatements,
  buildRevokeRepresentativeRoleStatement,
  resolveRepresentativeRoleHolders,
} from "../membership/representative-roles";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { getOrgAggregate, fetchOrgDetailRow, getOrganization } from "./read-model";
import { prepareAuditLog } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import {
  ORGANIZATION_SCALAR_CONTENT_COLUMN_BY_FIELD,
  serializeOrganizationContentValue,
} from "../organization-content/fields";
import type { OrganizationEditableContent } from "../../../../assets/shared/schemas/organization-profile";
import { authorizedOrganizationMutationDb } from "./authorization";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: "name",
  ...ORGANIZATION_SCALAR_CONTENT_COLUMN_BY_FIELD,
};

export interface OrganizationProfileUpdateInput extends OrganizationEditableContent {
  name?: string;
  membershipCategory?: string;
  memberSince?: string | null;
  primaryContactUserId?: string | null;
  secondaryContactUserId?: string | null;
  revision: string;
}

export async function updateOrganization(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  id: string,
  input: OrganizationProfileUpdateInput,
) {
  const existing = await fetchOrgDetailRow(db, id);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Organization not found");
  if (input.revision !== existing.updated_at) {
    throw new AppError(409, "ORGANIZATION_CHANGED", "The organization changed concurrently; reload and retry");
  }

  if (input.name !== undefined && normalizeOrgName(input.name) !== normalizeOrgName(existing.name)) {
    const conflict = await first<{ id: string }>(
      db,
      "SELECT id FROM organizations WHERE normalized_name = ? AND id != ?",
      [normalizeOrgName(input.name), id],
    );
    if (conflict) throw new AppError(409, "DUPLICATE", "Another organization already uses that name");
  }

  const authorizedDb = authorizedOrganizationMutationDb(db, actor, "organizations:write");
  const statements: StatementLike[] = [
    prepareAuthorizationGuard(authorizedDb, {
      sql: "SELECT 1 FROM organizations WHERE id = ? AND updated_at = ?",
      bindings: [id, input.revision],
    }),
  ];
  const now = nowIso();
  const existingAggregate = await getOrgAggregate(db, id);
  let aggregateId: string | null = existingAggregate?.id ?? null;
  if (input.membershipCategory !== undefined) {
    // Explicit staff-driven change, not the create-time race — always
    // apply the requested category rather than routing through
    // getOrCreateOrganizationMemberAggregate, which is a get-or-CREATE
    // primitive that rejects a differing category as a conflict (that
    // conflict guard exists for concurrent first-time creation, not for
    // an admin legitimately changing an already-assigned category here).
    if (existingAggregate) {
      aggregateId = existingAggregate.id;
      statements.push(
        authorizedDb
          .prepare("UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?")
          .bind(input.membershipCategory, now, aggregateId),
      );
    } else {
      const aggregate = buildGetOrCreateOrganizationMemberAggregateStatements(
        authorizedDb,
        id,
        input.membershipCategory,
        now,
      );
      aggregateId = aggregate.proposedId;
      statements.push(...aggregate.statements);
    }
  }

  for (const [field, userId] of [
    ["primaryContactUserId", input.primaryContactUserId],
    ["secondaryContactUserId", input.secondaryContactUserId],
  ] as const) {
    if (!userId || !aggregateId) continue;
    const isRepresentative = await isActiveRepresentative(db, aggregateId, userId);
    if (!isRepresentative) {
      throw new AppError(
        422,
        "NOT_A_REPRESENTATIVE",
        `${field} must be an existing representative of this organization`,
      );
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = (input as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    setClauses.push(`${column} = ?`);
    values.push(value);
  }
  if (input.name !== undefined) {
    setClauses.push("normalized_name = ?");
    values.push(normalizeOrgName(input.name));
  }
  if (input.links !== undefined) {
    setClauses.push("links_json = ?");
    values.push(serializeOrganizationContentValue("links", input.links));
  }

  const hasMutation = Object.keys(input).some((key) => key !== "revision");
  if (setClauses.length > 0 || hasMutation) {
    setClauses.push("updated_at = ?");
    values.push(now);
    values.push(id, input.revision);
    statements.push(
      authorizedDb
        .prepare(`UPDATE organizations SET ${setClauses.join(", ")} WHERE id = ? AND updated_at = ?`)
        .bind(...values),
    );
  }

  if (aggregateId && input.memberSince !== undefined) {
    statements.push(
      authorizedDb
        .prepare("UPDATE members SET member_since = ?, updated_at = ? WHERE id = ?")
        .bind(input.memberSince, now, aggregateId),
    );
  }
  if (aggregateId && input.membershipCategory !== undefined) {
    const representatives = await all<{ user_id: string }>(
      db,
      `SELECT user_id FROM organization_representatives
        WHERE member_id = ? AND left_at IS NULL AND blocked_at IS NULL
        ORDER BY user_id`,
      [aggregateId],
    );
    for (const representative of representatives) {
      statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, representative.user_id, now));
    }
  }
  if (aggregateId && (input.primaryContactUserId !== undefined || input.secondaryContactUserId !== undefined)) {
    // The secondary contact exists for redundancy; one person holding both
    // roles would silently defeat it. Validate the EFFECTIVE pair, so a
    // single-field update cannot collide with the retained other role.
    const holders = await resolveRepresentativeRoleHolders(db, aggregateId);
    const effectivePrimary =
      input.primaryContactUserId !== undefined ? input.primaryContactUserId : holders.primaryContactUserId;
    const effectiveSecondary =
      input.secondaryContactUserId !== undefined ? input.secondaryContactUserId : holders.secondaryContactUserId;
    if (effectivePrimary && effectiveSecondary && effectivePrimary === effectiveSecondary) {
      throw new AppError(
        400,
        "CONTACT_ROLES_MUST_DIFFER",
        "The primary and secondary contact must be different people.",
      );
    }
  }
  if (aggregateId && input.primaryContactUserId !== undefined) {
    if (input.primaryContactUserId) {
      statements.push(
        ...(await buildAssignRepresentativeRoleStatements(authorizedDb, {
          memberId: aggregateId,
          userId: input.primaryContactUserId,
          roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
          now,
        })),
      );
    } else {
      statements.push(
        buildRevokeRepresentativeRoleStatement(authorizedDb, {
          memberId: aggregateId,
          roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
          now,
        }),
      );
    }
  }
  if (aggregateId && input.secondaryContactUserId !== undefined) {
    if (input.secondaryContactUserId) {
      statements.push(
        ...(await buildAssignRepresentativeRoleStatements(authorizedDb, {
          memberId: aggregateId,
          userId: input.secondaryContactUserId,
          roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
          now,
        })),
      );
    } else {
      statements.push(
        buildRevokeRepresentativeRoleStatement(authorizedDb, {
          memberId: aggregateId,
          roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
          now,
        }),
      );
    }
  }

  statements.push(prepareAuditLog(authorizedDb, "admin", actor.id, "organization_updated", "organization", id, input));

  await authorizedDb.batch(statements);

  return getOrganization(db, id);
}
