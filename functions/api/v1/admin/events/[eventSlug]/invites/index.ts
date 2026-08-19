import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { all, first } from "../../../../../../_lib/db/queries";
import { resolveOrderBy } from "../../../../../../_lib/db/sort";
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

  const validStatuses = new Set(["sent", "accepted", "declined", "expired", "revoked"]);
  const validTypes = new Set(["attendee", "speaker"]);

  const conditions: string[] = ["i.event_id = ?"];
  const bindings: unknown[] = [event.id];

  if (statusFilter && validStatuses.has(statusFilter)) {
    conditions.push("i.status = ?");
    bindings.push(statusFilter);
  }

  if (typeFilter && validTypes.has(typeFilter)) {
    conditions.push("i.invite_type = ?");
    bindings.push(typeFilter);
  }

  if (search) {
    conditions.push(
      "(i.invitee_email LIKE ? OR COALESCE(i.invitee_first_name || ' ' || i.invitee_last_name, i.invitee_first_name, i.invitee_email) LIKE ?)",
    );
    const pattern = `%${search}%`;
    bindings.push(pattern, pattern);
  }

  const orderBy = resolveOrderBy(sort, EVENT_INVITES_SORT_COLUMNS, "ORDER BY i.created_at DESC");

  // The page query and the real COUNT(*) share the same WHERE filters and
  // run concurrently (P6M-P2-05/P6M-CC-03: this replaced a `limit+1`-and-
  // slice `hasMore` computed *in addition to* this same COUNT(*), which was
  // redundant work now that the count already exists).
  const [invites, totalRow] = await Promise.all([
    all(
      requestDb(c),
      `SELECT
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
      [...bindings, limit, offset],
    ),
    first<{ total: number }>(
      requestDb(c),
      `SELECT COUNT(*) AS total
       FROM invites i
       WHERE ${conditions.join(" AND ")}`,
      bindings,
    ),
  ]);
  const total = Number(totalRow?.total ?? 0);

  return json({
    invites,
    page: buildPageInfo(limit, offset, total, invites.length),
  });
});
