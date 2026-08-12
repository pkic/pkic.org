import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { getCachedAdminForRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { getWorkingGroupBySlugOrId } from "../../../../../../_lib/services/working-groups";
import { requestDb } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { WgMeetingsGet, WgMeetingsCreate } from "./index";
import meetingId_Router from "./[meetingId]/router";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * context-aware gate for /admin/working-groups/:id/meetings/**
 * — requires working-groups:read (GET) or working-groups:write (writes),
 * globally or scoped to this working group. This is what actually gives a
 * WG chair (role-wg_chair, context-scoped working-groups:write per
 * migration 0035) management of their own WG's meeting series,
 * "staff admin / WG chair in context" — the model is
 * events/[eventSlug]/router.ts's requireEventManagementAccess. Note this is
 * NOT the pattern the sibling /members endpoints under this same
 * working-groups/:id/ resource use today (they call requirePermission with
 * no context at all, a pre-existing gap noted during this planning
 * fixing that gap repo-wide is out of
 * scope here, but the new meetings surface is built correctly from the
 * start rather than copying the gap forward.
 */
async function requireWgMeetingsAccess(c: Context<RequestDbContext>, next: Next): Promise<void> {
  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing authenticated admin");
  }

  const wg = await getWorkingGroupBySlugOrId(requestDb(c), c.req.param("id") ?? "");
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }

  const permission = WRITE_METHODS.has(c.req.method) ? "working-groups:write" : "working-groups:read";
  requirePermission(admin, permission, { type: "working_group", id: wg.id });

  await next();
}

app.use("*", requireWgMeetingsAccess);

openapi.get("/", WgMeetingsGet);
openapi.post("/", WgMeetingsCreate);
openapi.route("/:meetingId", meetingId_Router);

export default openapi;
