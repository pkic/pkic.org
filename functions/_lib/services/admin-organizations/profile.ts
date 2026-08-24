/**
 * Admin Organizations profile update — the "manage an organization once
 * it's approved" surface the Interim Admin Tool didn't provide (that tool
 * only ever created new org+member rows, with no way to edit a profile
 * afterward). Split from the combined admin-organizations.ts (PR #1
 * review, Phase 8) — see queries.ts for reads and representatives.ts for
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
} from "../membership/representative-roles";
import type { DatabaseLike, StatementLike } from "../../types";
import { getOrgAggregate, fetchOrgDetailRow, getAdminOrganization } from "./queries";
import { prepareAuditLog } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import {
  ORGANIZATION_SCALAR_CONTENT_COLUMN_BY_FIELD,
  serializeOrganizationContentValue,
} from "../organization-content/fields";
import type { OrganizationEditableContent } from "../../../../assets/shared/schemas/organization-profile";

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: "name",
  ...ORGANIZATION_SCALAR_CONTENT_COLUMN_BY_FIELD,
};

export interface OrganizationUpdateInput extends OrganizationEditableContent {
  name?: string;
  membershipCategory?: string;
  memberSince?: string | null;
  primaryContactUserId?: string | null;
  secondaryContactUserId?: string | null;
}

export async function updateAdminOrganization(
  db: DatabaseLike,
  actorUserId: string,
  id: string,
  input: OrganizationUpdateInput,
) {
  const existing = await fetchOrgDetailRow(db, id);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Organization not found");

  if (input.name !== undefined && normalizeOrgName(input.name) !== normalizeOrgName(existing.name)) {
    const conflict = await first<{ id: string }>(
      db,
      "SELECT id FROM organizations WHERE normalized_name = ? AND id != ?",
      [normalizeOrgName(input.name), id],
    );
    if (conflict) throw new AppError(409, "DUPLICATE", "Another organization already uses that name");
  }

  const statements: StatementLike[] = [];
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
        db
          .prepare("UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?")
          .bind(input.membershipCategory, now, aggregateId),
      );
    } else {
      const aggregate = buildGetOrCreateOrganizationMemberAggregateStatements(db, id, input.membershipCategory, now);
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
    const value = (input as Record<string, unknown>)[key];
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

  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(now);
    values.push(id);
    statements.push(db.prepare(`UPDATE organizations SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values));
  }

  if (aggregateId && input.memberSince !== undefined) {
    statements.push(
      db
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
      statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(db, representative.user_id, now));
    }
  }
  if (aggregateId && input.primaryContactUserId !== undefined) {
    if (input.primaryContactUserId) {
      statements.push(
        ...(await buildAssignRepresentativeRoleStatements(db, {
          memberId: aggregateId,
          userId: input.primaryContactUserId,
          roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
          now,
        })),
      );
    } else {
      statements.push(
        buildRevokeRepresentativeRoleStatement(db, {
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
        ...(await buildAssignRepresentativeRoleStatements(db, {
          memberId: aggregateId,
          userId: input.secondaryContactUserId,
          roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
          now,
        })),
      );
    } else {
      statements.push(
        buildRevokeRepresentativeRoleStatement(db, {
          memberId: aggregateId,
          roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
          now,
        }),
      );
    }
  }

  statements.push(prepareAuditLog(db, "admin", actorUserId, "organization_updated", "organization", id, input));

  await db.batch(statements);

  return getAdminOrganization(db, id);
}
