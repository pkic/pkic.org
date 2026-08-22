import { Hono } from "hono";
import { fromHono } from "chanfana";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import type { RequestDbContext } from "../../../_lib/db/context";
import calendar_Router from "./calendar/router";
import email_Router from "./email/router";
import jobs_Router from "./jobs/router";
import reminders_Router from "./reminders/router";
import retention_Router from "./retention/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

function isSignedCalendarRsvp(path: string, method: string): boolean {
  const internalPrefix = "/api/v1/internal";
  const relativePath = path.startsWith(internalPrefix) ? path.slice(internalPrefix.length) : path;
  return method.toUpperCase() === "POST" && relativePath === "/calendar/rsvp";
}

app.use("*", async (c, next) => {
  // Calendar replies use their own bounded, replay-protected HMAC boundary.
  // Every other internal operation is an administrative write and must hold
  // the global permission; contextual grants cannot satisfy this check.
  if (!isSignedCalendarRsvp(c.req.path, c.req.method)) {
    const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
    requirePermission(admin, "admin:write");
  }
  await next();
});

openapi.route("/calendar", calendar_Router);
openapi.route("/email", email_Router);
openapi.route("/jobs", jobs_Router);
openapi.route("/reminders", reminders_Router);
openapi.route("/retention", retention_Router);

export default openapi;
