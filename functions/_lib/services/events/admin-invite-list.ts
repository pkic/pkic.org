import {
  EVENT_INVITES_SORT_COLUMNS,
  type AdminEventInvitesListQuery,
} from "../../../../assets/shared/schemas/admin-events";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

export async function listAdminEventInvites(db: DatabaseLike, eventId: string, query: AdminEventInvitesListQuery) {
  const conditions: string[] = ["i.event_id = ?"];
  const bindings: unknown[] = [eventId];
  if (query.status) {
    conditions.push("i.status = ?");
    bindings.push(query.status);
  }
  if (query.type) {
    conditions.push("i.invite_type = ?");
    bindings.push(query.type);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "i.invitee_email",
      "i.invitee_first_name",
      "i.invitee_last_name",
      "i.invitee_first_name || ' ' || i.invitee_last_name",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.join(" AND ");
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      invitee_email: "i.invitee_email",
      status: "i.status",
      created_at: "i.created_at",
      accepted_at: "i.accepted_at",
    } satisfies Record<(typeof EVENT_INVITES_SORT_COLUMNS)[number], string>,
    "i.created_at DESC",
    "i.id ASC",
  );
  const { rows: invites, total } = await queryPage(db, {
    sql: `SELECT
         i.id,
         i.invitee_email,
         i.invitee_first_name,
         i.invitee_last_name,
         i.invite_type,
         i.status,
         i.decline_reason_code,
         i.decline_reason_note,
         i.unsubscribe_future,
         i.reminder_count,
         i.source_type,
         i.expires_at,
         i.accepted_at,
         i.declined_at,
         i.created_at,
         i.inviter_user_id,
         u.email AS inviter_email,
         u.first_name AS inviter_first_name,
         u.last_name AS inviter_last_name
       FROM invites i
       LEFT JOIN users u ON u.id = i.inviter_user_id
       WHERE ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  return {
    invites,
    page: buildPageInfo(query.limit, query.offset, total, invites.length),
  };
}
