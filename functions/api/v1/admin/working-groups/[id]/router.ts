import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { getCachedAdminForRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getWorkingGroupBySlugOrId } from "../../../../../_lib/services/working-groups";
import { requestDb } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { WorkingGroupGet, WorkingGroupUpdate } from "./index";
import members_Router from "./members/router";
import meetings_Router from "./meetings/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Context-aware gate for the whole /admin/working-groups/:id/** subtree
 * (detail/update, members, meetings, meeting ICS files) — requires
 * working-groups:read (GET) or working-groups:write (writes), globally or
 * scoped to this working group. Mirrors requireEventManagementAccess
 * (events/[eventSlug]/router.ts) and replaces the narrower
 * requireWgMeetingsAccess this router.ts used to only apply to /meetings/**
 * — resolving the working group once here, for the whole subtree, is what
 * actually gives a role-wg_chair grant (context-scoped
 * working-groups:write per migration 0038) management of their own WG's
 * roster, not just its meetings.
 */
async function requireWorkingGroupAccess(c: Context<RequestDbContext>, next: Next): Promise<void> {
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

app.use("*", requireWorkingGroupAccess);

openapi.get("/", WorkingGroupGet);
openapi.patch("/", WorkingGroupUpdate);
openapi.route("/members", members_Router);
openapi.route("/meetings", meetings_Router);

export default openapi;
