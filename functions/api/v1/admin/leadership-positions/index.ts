/**
 * GET  /api/v1/admin/leadership-positions?body=board|executive_council
 * POST /api/v1/admin/leadership-positions
 *
 * Admin CRUD for the Board of Directors / Executive Council rosters
 * (migration 0049) — see functions/_lib/services/leadership.ts for the
 * design rationale (why a dedicated table instead of user_roles). Gated by
 * the same access:grant/access:revoke permissions the existing chair
 * assignment endpoints use, since this is the same kind of designation
 * management.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { parseJsonBody } from "../../../../_lib/validation";
import { listLeadershipPositionsAdmin, createLeadershipPosition } from "../../../../_lib/services/leadership";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { AppError } from "../../../../_lib/errors";
import {
  leadershipPositionCreateSchema,
  leadershipPositionsListQuerySchema,
  leadershipPositionsListRouteSchema,
  leadershipPositionsCreateRouteSchema,
} from "../../../../../assets/shared/schemas/leadership";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const url = new URL(c.req.raw.url);
  const parsed = leadershipPositionsListQuerySchema.safeParse({ body: url.searchParams.get("body") ?? undefined });
  if (!parsed.success) {
    throw new AppError(400, "INVALID_BODY", "body must be 'board' or 'executive_council'");
  }

  const positions = await listLeadershipPositionsAdmin(requestDb(c), parsed.data.body);
  return json({ positions });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const body = await parseJsonBody(c.req, leadershipPositionCreateSchema);
  const position = await createLeadershipPosition(requestDb(c), body);

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "leadership_position_created",
    "leadership_position",
    position.id,
    {
      body: position.body,
      userId: position.userId,
      title: position.title,
    },
  );

  return json(position, 201);
}

export class LeadershipPositionsList extends OpenAPIRoute {
  schema = leadershipPositionsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class LeadershipPositionsCreate extends OpenAPIRoute {
  schema = leadershipPositionsCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
