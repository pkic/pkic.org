import type { MailingListsListQuery } from "../../../../assets/shared/schemas/mailing-lists";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups/governance";
import type { AuthAdmin } from "../../types";
import { isAuthorizationGuardFailure, type AuthorizationEvidence } from "../../db/authorization-guard";
import { buildOffsetPageStatements, decodeOffsetPageResults, type OffsetPageQuery } from "../../db/pagination";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { appendMailingListFilters, resolveMailingListOrderBy } from "../mailing-list-query";
import { requireManagedGroupMailingList } from "./authorization";
import { MAILING_LIST_COLUMNS, type MailingListRow, toMailingList } from "./record";
import {
  buildLiveAccessibleGroupResourceIdsCte,
  liveGroupResourceContextAccess,
  type AccessibleGroupResourceIdsCte,
} from "../resource-grants";

export function buildMailingListsPageQuery(
  query: MailingListsListQuery,
  options: {
    groupId?: string;
    requiredAuthorization?: AuthorizationEvidence;
    accessibleResources?: AccessibleGroupResourceIdsCte;
  },
): OffsetPageQuery {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.accessibleResources) {
    bindings.push(...options.accessibleResources.bindings);
  } else if (options.groupId) {
    conditions.push("mailing_lists.group_id = ?");
    bindings.push(options.groupId);
  } else if (!options.requiredAuthorization) {
    throw new Error("A group, accessible resource set, or explicit authorization is required for mailing-list pages");
  }
  appendMailingListFilters(query, conditions, bindings);
  if (options.requiredAuthorization) {
    conditions.push(`EXISTS (${options.requiredAuthorization.sql})`);
    bindings.push(...options.requiredAuthorization.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return {
    sql: `${options.accessibleResources ? `WITH ${options.accessibleResources.sql} ` : ""}
      SELECT ${MAILING_LIST_COLUMNS}
        FROM mailing_lists
        ${options.accessibleResources ? "JOIN accessible_resource ON accessible_resource.resource_id = mailing_lists.id" : ""}
        ${where}`,
    bindings,
    orderBy: resolveMailingListOrderBy(query.sort, "purpose ASC, email ASC"),
    limit: query.limit,
    offset: query.offset,
  };
}

/** Lists only configurations currently manageable by the selected group actor. */
export async function listGroupManagedMailingLists(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  query: MailingListsListQuery,
) {
  await requireGroupManagement(db, actor, groupId);
  const pageQuery = buildMailingListsPageQuery(query, {
    accessibleResources: buildLiveAccessibleGroupResourceIdsCte(
      "mailingList",
      groupId,
      liveGroupResourceContextAccess({ userId: actor.id, admin: actor }, groupId),
      "manage",
    ),
  });
  try {
    const [, pageResult, countResult] = await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      ...buildOffsetPageStatements(db, pageQuery),
    ]);
    const { rows, total } = decodeOffsetPageResults<MailingListRow>(pageResult, countResult);
    return { mailingLists: rows.map(toMailingList), total };
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
    }
    throw error;
  }
}

/**
 * One list, read through the group that manages it. The record page and the
 * row's menu ask the same question the list page did, so ownership and the
 * shared manage grant are resolved by the same helper the writes use.
 */
export async function getGroupManagedMailingList(db: DatabaseLike, actor: AuthAdmin, groupId: string, listId: string) {
  await requireManagedGroupMailingList(db, actor, groupId, listId);
  return loadMailingList(db, listId);
}

/** Reads one list back after a write, so a command answers with what was actually stored. */
export async function loadMailingList(db: DatabaseLike, id: string) {
  const row = await first<MailingListRow>(db, `SELECT ${MAILING_LIST_COLUMNS} FROM mailing_lists WHERE id = ?`, [id]);
  if (!row) throw new AppError(500, "MAILING_LIST_READ_FAILED", "Failed to read the mailing list after mutation");
  return toMailingList(row);
}

export async function resolveAutoSyncListEmails(db: DatabaseLike, membershipCategory: string): Promise<string[]> {
  const rows = await all<Pick<MailingListRow, "email">>(
    db,
    `SELECT email FROM mailing_lists
      WHERE active = 1 AND archived_at IS NULL
        AND purpose IN ('all_members', 'consultation')
        AND (
          auto_sync_categories_json IS NULL
          OR EXISTS (
            SELECT 1 FROM json_each(mailing_lists.auto_sync_categories_json) WHERE value = ?
          )
        )
      ORDER BY email ASC`,
    [membershipCategory],
  );
  return rows.map((row) => row.email);
}
