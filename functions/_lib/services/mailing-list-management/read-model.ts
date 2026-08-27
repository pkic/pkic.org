import { MAILING_LIST_SORT_COLUMNS, type MailingListsListQuery } from "../../../../assets/shared/schemas/mailing-lists";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups/governance";
import type { AuthAdmin } from "../../types";
import { isAuthorizationGuardFailure, type AuthorizationEvidence } from "../../db/authorization-guard";
import { buildOffsetPageStatements, decodeOffsetPageResults, type OffsetPageQuery } from "../../db/pagination";
import { all } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
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
  } else {
    throw new Error("A group or accessible resource set is required for mailing-list pages");
  }
  const search = query.q ? buildD1TextSearchFilter(query.q, ["email", "label", "purpose"]) : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.purpose) {
    conditions.push("purpose = ?");
    bindings.push(query.purpose);
  }
  if (query.active !== undefined) conditions.push(query.active ? "active = 1" : "active = 0");
  if (query.primaryDiscussion !== undefined) {
    conditions.push(query.primaryDiscussion ? "is_primary_discussion = 1" : "is_primary_discussion = 0");
  }
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
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        email: "email COLLATE NOCASE",
        label: "label COLLATE NOCASE",
        purpose: "purpose",
        active: "active",
        created_at: "created_at",
      } satisfies Record<(typeof MAILING_LIST_SORT_COLUMNS)[number], string>,
      "purpose ASC, email ASC",
      "id ASC",
    ),
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
