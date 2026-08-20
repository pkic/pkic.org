import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { queryPage } from "../../../../../../_lib/db/pagination";
import { buildD1TextSearchFilter } from "../../../../../../_lib/db/search";
import { resolveMappedOrderBy } from "../../../../../../_lib/db/sort";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  EVENT_INVITES_SORT_COLUMNS,
  adminEventInvitesListQuerySchema,
  eventSlugParamsSchema,
} from "../../../../../../../assets/shared/schemas/api";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";

const adminEventInvitesListRouteSchema = {
  tags: ["Admin events"],
  summary: "List invites for an event (admin)",
  description: "Paginated, optionally status/type-filtered list of invites for an event.",
  request: { params: eventSlugParamsSchema, query: adminEventInvitesListQuerySchema },
  responses: {
    "200": { description: "Invites list." },
  },
};

/**
 * GET /api/v1/admin/events/:eventSlug/invites
 *
 * Returns a bounded page of invites for an event, with optional status filter.
 * Query params:
 *   ?status=sent|accepted|declined|expired|revoked   (omit for all)
 *   ?type=attendee|speaker                            (omit for all)
 */
export const AdminEventInvitesList = openApiRoute(adminEventInvitesListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  const { limit = 50, offset = 0, sort } = data.query;
  const statusFilter = data.query.status;
  const typeFilter = data.query.type;
  const search = data.query.q ?? "";

  const conditions: string[] = ["i.event_id = ?"];
  const bindings: unknown[] = [event.id];

  if (statusFilter) {
    conditions.push("i.status = ?");
    bindings.push(statusFilter);
  }

  if (typeFilter) {
    conditions.push("i.invite_type = ?");
    bindings.push(typeFilter);
  }

  if (search) {
    const filter = buildD1TextSearchFilter(search, [
      "i.invitee_email",
      "i.invitee_first_name",
      "i.invitee_last_name",
      "i.invitee_first_name || ' ' || i.invitee_last_name",
    ]);
    conditions.push(filter.sql);
    bindings.push(...filter.bindings);
  }

  const orderBy = resolveMappedOrderBy(
    sort,
    {
      invitee_email: "i.invitee_email",
      status: "i.status",
      created_at: "i.created_at",
      accepted_at: "i.accepted_at",
    } satisfies Record<(typeof EVENT_INVITES_SORT_COLUMNS)[number], string>,
    "i.created_at DESC",
    "i.id ASC",
  );

  // The page query and the real COUNT(*) share the same WHERE filters and
  // execute in one D1 batch. This replaces a `limit+1`-and-slice `hasMore`
  // calculation performed in addition to the same COUNT(*).
  const { rows: invites, total } = await queryPage(
    requestDb(c),
    {
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
         u.email      AS inviter_email,
         u.first_name AS inviter_first_name,
         u.last_name  AS inviter_last_name
       FROM invites i
       LEFT JOIN users u ON u.id = i.inviter_user_id
       WHERE ${conditions.join(" AND ")}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      bindings: [...bindings, limit, offset],
    },
    {
      sql: `SELECT COUNT(*) AS total
       FROM invites i
       WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
  );

  return json({
    invites,
    page: buildPageInfo(limit, offset, total, invites.length),
  });
});
