import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { getCachedAdminForRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { requestDb } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { AdminEventRegistrationsGet } from "./registrations";
import emails_Router from "./emails/router";
import registrations_Router from "./registrations/router";
import waitlist_Router from "./waitlist/router";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Context-aware gate for the /admin/events/:eventSlug/**
 * compatibility surface (registrations, waitlist, and emails) — requires events:read (GET) or
 * events:write (writes), globally or scoped to this event. Global admins
 * pass unconditionally via requirePermission's role='admin' bypass, so
 * existing behavior under the single-tier admin model is unchanged; this
 * is what actually gives a event_organizer grant "full management
 * of a specific event" (P7) instead of just admin-only access.
 *
 */
async function requireEventManagementAccess(c: Context<RequestDbContext>, next: Next): Promise<void> {
  const eventSlug = c.req.param("eventSlug") ?? "";
  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing authenticated admin");
  }

  const event = await getEventBySlug(requestDb(c), eventSlug);
  const permission = WRITE_METHODS.has(c.req.method) ? "events:write" : "events:read";
  requirePermission(admin, permission, { type: "event", id: event.id });

  await next();
}

app.use("*", requireEventManagementAccess);

openapi.get("/registrations", AdminEventRegistrationsGet);
openapi.route("/emails", emails_Router);
openapi.route("/registrations", registrations_Router);
openapi.route("/waitlist", waitlist_Router);

export default openapi;
