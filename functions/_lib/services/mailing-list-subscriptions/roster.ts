import {
  MAILING_LIST_SUBSCRIBER_SORT_COLUMNS,
  mailingListSubscriberSchema,
  type MailingListSubscribersListQuery,
} from "../../../../assets/shared/schemas/mailing-lists";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { activeUserCapacitiesCte } from "../membership/capacity-query";
import {
  EFFECTIVE_SUBSCRIPTION_VALUE_SQL,
  mailingListDefaultSubscribedSql,
  mailingListEligibilitySql,
} from "./projection";

interface MailingListSubscriberRow {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  preference: "subscribed" | "unsubscribed" | null;
  eligible: number;
  default_subscribed: number;
  subscribed: number;
}

/**
 * Who could conceivably stand on this list, expressed as SQL rather than
 * fetched into the Worker.
 *
 * A list whose eligibility follows group membership can only ever reach the
 * owning group, the groups it was shared with, and whoever has already
 * answered for it. A list whose eligibility follows membership category is
 * open to every member, so its candidate set is every active account — the
 * same set the reconciler walks.
 */
function candidateUsersSql(listId: string, purpose: string): { sql: string; bindings: unknown[] } {
  return {
    bindings: [listId, listId, listId],
    sql: `SELECT membership.user_id
            FROM group_memberships membership
            JOIN mailing_lists owner_list ON owner_list.group_id = membership.group_id
           WHERE owner_list.id = ? AND membership.left_at IS NULL
           UNION
          SELECT preference.user_id
            FROM mailing_list_subscription_preferences preference
           WHERE preference.mailing_list_id = ?
           UNION
          SELECT shared_membership.user_id
            FROM mailing_list_group_grants grant_row
            JOIN group_memberships shared_membership
              ON shared_membership.group_id = grant_row.group_id
             AND shared_membership.left_at IS NULL
           WHERE grant_row.mailing_list_id = ? AND grant_row.capability = 'subscribe'
           ${purpose === "group" ? "" : "UNION SELECT id FROM users WHERE active = 1"}`,
  };
}

/**
 * One list's roster: everyone eligible for it, what they chose, and whether
 * that adds up to a delivery.
 *
 * `subscribed` deliberately ignores whether the list itself is archived. An
 * archived list delivers to nobody, and the record page says so in its own
 * header; the roster's job is to show who is on it — and would receive it
 * again the moment it is restored.
 */
export async function listMailingListSubscribers(
  db: DatabaseLike,
  listId: string,
  query: MailingListSubscribersListQuery,
): Promise<{ subscribers: ReturnType<typeof mailingListSubscriberSchema.parse>[]; page: PageInfo }> {
  const list = await first<{ purpose: string }>(db, "SELECT purpose FROM mailing_lists WHERE id = ?", [listId]);
  if (!list) throw new AppError(404, "MAILING_LIST_NOT_FOUND", "Mailing list not found");

  const candidates = candidateUsersSql(listId, list.purpose);
  const bindings: unknown[] = [...candidates.bindings, listId];
  const conditions: string[] = [];
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["email", "first_name", "last_name", "first_name || ' ' || last_name"])
    : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.subscribed !== undefined) conditions.push(query.subscribed ? "subscribed = 1" : "subscribed = 0");

  const { rows, total } = await queryPage<MailingListSubscriberRow>(db, {
    sql: `${activeUserCapacitiesCte(candidates.sql)},
      roster AS (
        SELECT person.id AS user_id, person.email, person.first_name, person.last_name,
               person.organization_name, preference.preference AS preference,
               ${mailingListEligibilitySql("list", "person.id")} AS eligible,
               ${mailingListDefaultSubscribedSql("list", "person.id")} AS default_subscribed
          FROM eligible_input candidate
          JOIN users person ON person.id = candidate.user_id
          JOIN mailing_lists list ON list.id = ?
     LEFT JOIN mailing_list_subscription_preferences preference
            ON preference.mailing_list_id = list.id AND preference.user_id = person.id
      ),
      roster_state AS (
        SELECT user_id, email, first_name, last_name, organization_name, preference, eligible,
               default_subscribed, ${EFFECTIVE_SUBSCRIPTION_VALUE_SQL} AS subscribed
          FROM roster
      )
      SELECT user_id, email, first_name, last_name, organization_name, preference, eligible,
             default_subscribed, subscribed
        FROM roster_state
       ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        email: "email COLLATE NOCASE",
        first_name: "first_name COLLATE NOCASE",
        last_name: "last_name COLLATE NOCASE",
        subscribed: "subscribed",
      } satisfies Record<(typeof MAILING_LIST_SUBSCRIBER_SORT_COLUMNS)[number], string>,
      "subscribed DESC, email COLLATE NOCASE ASC",
      "user_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });

  const subscribers = rows.map((row) =>
    mailingListSubscriberSchema.parse({
      user: {
        id: row.user_id,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        organization_name: row.organization_name,
      },
      eligible: row.eligible === 1,
      defaultSubscribed: row.default_subscribed === 1,
      preference: row.preference,
      subscribed: row.subscribed === 1,
    }),
  );
  return { subscribers, page: buildPageInfo(query.limit, query.offset, total, subscribers.length) };
}
