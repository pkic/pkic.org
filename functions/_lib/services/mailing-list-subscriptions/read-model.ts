import {
  MAILING_LIST_SORT_COLUMNS,
  effectiveMailingListSubscriptionSchema,
  type GroupMailingListSubscriptionsQuery,
} from "../../../../assets/shared/schemas/mailing-lists";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { toMailingList, type MailingListRow } from "../mailing-list-record";
import { liveGroupResourceContextAccess } from "../resource-grants/access";
import { buildLiveAccessibleGroupResourceIdsCte } from "../resource-grants/access-query";
import { EFFECTIVE_SUBSCRIPTION_CTE, EFFECTIVE_SUBSCRIPTION_VALUE_SQL } from "./projection";

interface EffectiveSubscriptionRow extends MailingListRow {
  preference: "subscribed" | "unsubscribed" | null;
  eligible: number;
  default_subscribed: number;
  effective_subscribed: number;
}

const SELECT_COLUMNS = `id, email, label, purpose, group_id, is_primary_discussion,
  subscription_default, posting_policy, moderation_policy, auto_sync_categories_json,
  active, archived_at, created_at, updated_at, preference, eligible, default_subscribed,
  ${EFFECTIVE_SUBSCRIPTION_VALUE_SQL} AS effective_subscribed`;

export async function resolveGroupId(db: DatabaseLike, idOrSlug: string): Promise<string> {
  const group = await first<{ id: string }>(db, "SELECT id FROM groups WHERE (id = ? OR slug = ?) AND active = 1", [
    idOrSlug,
    idOrSlug,
  ]);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Active group not found");
  return group.id;
}

function mapRow(row: EffectiveSubscriptionRow) {
  return effectiveMailingListSubscriptionSchema.parse({
    mailingList: toMailingList(row),
    eligible: row.eligible === 1,
    defaultSubscribed: row.default_subscribed === 1,
    preference: row.preference,
    effectiveSubscribed: row.effective_subscribed === 1,
  });
}

export async function getEffectiveMailingListSubscription(db: DatabaseLike, userId: string, listId: string) {
  const row = await first<EffectiveSubscriptionRow>(
    db,
    `${EFFECTIVE_SUBSCRIPTION_CTE}
     SELECT ${SELECT_COLUMNS} FROM effective_subscriptions WHERE id = ?`,
    [userId, listId],
  );
  if (!row) throw new AppError(404, "MAILING_LIST_NOT_FOUND", "Active mailing list not found");
  return mapRow(row);
}

export async function listEffectiveGroupMailingListSubscriptions(
  db: DatabaseLike,
  userId: string,
  groupIdOrSlug: string,
  query: GroupMailingListSubscriptionsQuery,
): Promise<{ subscriptions: ReturnType<typeof mapRow>[]; page: PageInfo }> {
  const groupId = await resolveGroupId(db, groupIdOrSlug);
  const accessibleLists = buildLiveAccessibleGroupResourceIdsCte(
    "mailingList",
    groupId,
    liveGroupResourceContextAccess({ userId }, groupId),
    "view",
  );
  const conditions: string[] = [];
  const bindings: unknown[] = [userId, ...accessibleLists.bindings];
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
  const { rows, total } = await queryPage<EffectiveSubscriptionRow>(db, {
    sql: `${EFFECTIVE_SUBSCRIPTION_CTE}, ${accessibleLists.sql}
      SELECT ${SELECT_COLUMNS}
        FROM effective_subscriptions
        JOIN accessible_resource accessible ON accessible.resource_id = effective_subscriptions.id
       ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}`,
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
      "is_primary_discussion DESC, label COLLATE NOCASE ASC",
      "id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const subscriptions = rows.map(mapRow);
  return { subscriptions, page: buildPageInfo(query.limit, query.offset, total, subscriptions.length) };
}
