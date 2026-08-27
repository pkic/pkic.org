import {
  EVENT_INVITES_SORT_COLUMNS,
  type EventInviteSummary,
  type EventInvitesListQuery,
} from "../../../../assets/shared/schemas/event-invites";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { effectiveInviteExpirySql } from "../../invite-validity";

export type EventInviteRow = Omit<EventInviteSummary, "actions">;

/** Lists only the server-selected invite type; callers cannot widen this scope. */
export async function listEventInvitesOfType(
  db: DatabaseLike,
  eventId: string,
  inviteType: NonNullable<EventInvitesListQuery["type"]>,
  query: Omit<EventInvitesListQuery, "type">,
) {
  return listEventInvites(db, eventId, { ...query, type: inviteType });
}

/** Lists event invitations with all search, filtering, sorting, and paging in D1. */
export async function listEventInvites(
  db: DatabaseLike,
  eventId: string,
  query: EventInvitesListQuery,
): Promise<{ invites: EventInviteSummary[]; page: ReturnType<typeof buildPageInfo> }> {
  const { rows, total } = await queryPage<EventInviteRow>(db, buildEventInvitesPageQuery(eventId, query));
  return buildEventInviteListResult(query, rows, total);
}

export function buildEventInviteListResult(
  query: Pick<EventInvitesListQuery, "limit" | "offset">,
  rows: EventInviteRow[],
  total: number,
): { invites: EventInviteSummary[]; page: ReturnType<typeof buildPageInfo> } {
  const invites = rows.map((invite) => ({
    ...invite,
    actions: {
      resend: invite.status !== "accepted" && invite.status !== "revoked",
      revoke: invite.status === "sent",
    },
  }));
  return { invites, page: buildPageInfo(query.limit, query.offset, total, invites.length) };
}

/** Builds the canonical page/count query pair so production SQL can be EXPLAIN-tested. */
export function buildEventInvitesPageQuery(eventId: string, query: EventInvitesListQuery): OffsetPageQuery {
  const conditions: string[] = ["i.event_id = ?"];
  const bindings: unknown[] = [eventId];
  const effectiveExpiry = effectiveInviteExpirySql("i", "e");
  const effectiveStatus = `CASE
    WHEN i.status = 'sent' AND (${effectiveExpiry} IS NULL OR unixepoch(${effectiveExpiry}) <= unixepoch())
      THEN 'expired'
    ELSE i.status
  END`;
  if (query.status) {
    conditions.push(`${effectiveStatus} = ?`);
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
  return {
    source: {
      selectSql: `SELECT
         i.id,
         i.invitee_email AS inviteeEmail,
         i.invitee_first_name AS inviteeFirstName,
         i.invitee_last_name AS inviteeLastName,
         i.invite_type AS inviteType,
         ${effectiveStatus} AS status,
         i.decline_reason_code AS declineReasonCode,
         i.decline_reason_note AS declineReasonNote,
         i.unsubscribe_future AS unsubscribeFuture,
         i.reminder_count AS reminderCount,
         i.source_type AS sourceType,
         ${effectiveExpiry} AS expiresAt,
         i.accepted_at AS acceptedAt,
         i.declined_at AS declinedAt,
         i.created_at AS createdAt,
         i.inviter_user_id AS inviterUserId,
         u.email AS inviterEmail,
         u.first_name AS inviterFirstName,
         u.last_name AS inviterLastName`,
      fromSql: `FROM invites i
       JOIN events e ON e.id = i.event_id
       LEFT JOIN users u ON u.id = i.inviter_user_id
       WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        invitee_email: "i.invitee_email",
        status: effectiveStatus,
        created_at: "i.created_at",
        accepted_at: "i.accepted_at",
      } satisfies Record<(typeof EVENT_INVITES_SORT_COLUMNS)[number], string>,
      "i.created_at DESC",
      "i.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}
