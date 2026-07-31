/**
 * PATCH  /api/v1/admin/leadership-positions/:id — edit title/from/till
 * DELETE /api/v1/admin/leadership-positions/:id — remove a position
 *
 * See ./index.ts for the create/list side and
 * functions/_lib/services/leadership.ts for the design rationale.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { parseJsonBody } from "../../../../_lib/validation";
import { updateLeadershipPosition, deleteLeadershipPosition } from "../../../../_lib/services/leadership";
import { writeAuditLog } from "../../../../_lib/services/audit";
import {
  leadershipPositionUpdateSchema,
  leadershipPositionUpdateRouteSchema,
  leadershipPositionDeleteRouteSchema,
} from "../../../../../assets/shared/schemas/leadership";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const patch = await parseJsonBody(c.req, leadershipPositionUpdateSchema);
  const position = await updateLeadershipPosition(requestDb(c), c.req.param("id"), patch);

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "leadership_position_updated",
    "leadership_position",
    position.id,
    patch,
  );

  return json(position);
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:revoke");

  const id = c.req.param("id");
  await deleteLeadershipPosition(requestDb(c), id);
  await writeAuditLog(requestDb(c), "admin", admin.id, "leadership_position_deleted", "leadership_position", id, {});

  return json({ success: true });
}

export class LeadershipPositionUpdate extends OpenAPIRoute {
  schema = leadershipPositionUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

export class LeadershipPositionDelete extends OpenAPIRoute {
  schema = leadershipPositionDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
