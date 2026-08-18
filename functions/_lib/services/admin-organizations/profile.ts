/**
 * Admin Organizations profile update — the "manage an organization once
 * it's approved" surface the Interim Admin Tool didn't provide (that tool
 * only ever created new org+member rows, with no way to edit a profile
 * afterward). Split from the combined admin-organizations.ts (PR #1
 * review, Phase 8) — see queries.ts for reads and representatives.ts for
 * representative/member provisioning.
 */
import { first, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { normalizeOrgName } from "../sponsorship";
import { serializeLinks } from "../../../../assets/shared/schemas/links";
import { getOrCreateOrganizationMemberAggregate } from "../membership/memberships";
import { isActiveRepresentative } from "../membership/representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  buildAssignRepresentativeRoleStatements,
  buildRevokeRepresentativeRoleStatement,
} from "../membership/representative-roles";
import type { DatabaseLike, StatementLike } from "../../types";
import { getOrgAggregate, fetchOrgDetailRow, getAdminOrganization } from "./queries";

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  website: "website",
  contentMarkdown: "content_markdown",
  slogan: "slogan",
  blogUrl: "blog_url",
  blogFeedUrl: "blog_feed_url",
  pressUrl: "press_url",
  pressFeedUrl: "press_feed_url",
  careersUrl: "careers_url",
};

export interface OrganizationUpdateInput {
  name?: string;
  membershipCategory?: string;
  memberSince?: string | null;
  description?: string | null;
  website?: string | null;
  contentMarkdown?: string | null;
  slogan?: string | null;
  blogUrl?: string | null;
  blogFeedUrl?: string | null;
  pressUrl?: string | null;
  pressFeedUrl?: string | null;
  careersUrl?: string | null;
  links?: string[];
  primaryContactUserId?: string | null;
  secondaryContactUserId?: string | null;
}

export async function updateAdminOrganization(db: DatabaseLike, id: string, input: OrganizationUpdateInput) {
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

  let aggregateId: string | null;
  if (input.membershipCategory !== undefined) {
    // Explicit staff-driven change, not the create-time race — always
    // apply the requested category rather than routing through
    // getOrCreateOrganizationMemberAggregate, which is a get-or-CREATE
    // primitive that rejects a differing category as a conflict (that
    // conflict guard exists for concurrent first-time creation, not for
    // an admin legitimately changing an already-assigned category here).
    const existingAggregate = await getOrgAggregate(db, id);
    if (existingAggregate) {
      aggregateId = existingAggregate.id;
      await run(db, "UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?", [
        input.membershipCategory,
        nowIso(),
        aggregateId,
      ]);
    } else {
      const aggregate = await getOrCreateOrganizationMemberAggregate(db, id, input.membershipCategory);
      aggregateId = aggregate.id;
    }
  } else {
    const aggregate = await getOrgAggregate(db, id);
    aggregateId = aggregate?.id ?? null;
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
    values.push(serializeLinks(input.links));
  }

  const statements: StatementLike[] = [];
  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso());
    values.push(id);
    statements.push(db.prepare(`UPDATE organizations SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values));
  }

  const now = nowIso();
  if (aggregateId && input.memberSince !== undefined) {
    statements.push(
      db
        .prepare("UPDATE members SET member_since = ?, updated_at = ? WHERE id = ?")
        .bind(input.memberSince, now, aggregateId),
    );
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

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return getAdminOrganization(db, id);
}
